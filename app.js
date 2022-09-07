require("dotenv").config();
const { App, ExpressReceiver } = require("@slack/bolt");
const bodyParser = require("body-parser");
const logBunyan = require("@google-cloud/logging-bunyan");

const FS_ASSISTANT_CHANNEL = "C040SH1GX5Z";
const TWILIO_NUMBER = "+13157582817";

async function StartServer() {
  const { logger, mw } = await logBunyan.express.middleware({
    logName: "fs-slack-assistant",
    projectId: "fsl-hackathon-2022",
    keyFilename: "fsl-hackathon-2022-55239864ff67.json",
    redirectToStdout: true
  });

  const receiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET });
  receiver.router.use(bodyParser.json());
  receiver.router.use(bodyParser.urlencoded({ extended: true }));
  receiver.router.use(mw);

  const app = new App({
    receiver,
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN,
    port: process.env.PORT || 3000
  });

  const twilioClient = new require("twilio")(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

  receiver.router.get("/ping", (req, res) => {
    req.log.info("Ping Request Received");
    res.writeHead(200);
    res.end("Pong!");
  });

  receiver.router.post("/schedule-wo", async (req, res) => {
    if (req.body.length < 1) {
      req.log.error("Invalid request received!");
      res.writeHead(400);
      res.end("Invalid Request");
      return;
    }

    const message = req.body[0];
    const to = message.phoneNumber;
    const body = `Appointment scheduled for ph#: ${message.phoneNumber} \n
                  Description: ${message.appointment.subject}\n
                  Starting at:${message.appointment.startTime} - Ending at: ${message.appointment.endTime}\n
                  Address: ${message.appointment.address.street} - ${message.appointment.address.city} - ${message.appointment.address.state} - ${message.appointment.address.postalCode} - ${message.appointment.address.country}\n
                  Appointment Id: ${message.appointment.appointmentId}`;

    app.client.chat.postMessage({
      text: body,
      channel: FS_ASSISTANT_CHANNEL
    });

    try {
      const responseTwilio = await twilioClient.messages.create({
        to,
        body,
        from: TWILIO_NUMBER
      });

      req.log.info("Twilio message sent", responseTwilio);
      res.writeHead(200);
      res.end("ok!");
    } catch (error) {
      req.log.error("Error sending to Twilio", error);
      res.writeHead(400);
      res.end("Error sending message");
    }
  });

  receiver.router.post("/reply", (req, res) => {
    const from = req.body.from;
    const body = req.body.msg;

    app.client.chat.postMessage({
      text: `response from ${from}: ${body}`,
      channel: FS_ASSISTANT_CHANNEL
    });
  });

  // Just a quick verification than the bot is alive.
  app.message("are you there?", async ({ message, say }) => {
    await say({
      text: `Yes <@${message.user}>! I am here.`
    });
  });

  await app.start(process.env.PORT || 3000);
  logger.info("Slack Bot FS Assistant is running!");
}

StartServer();
