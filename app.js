require("dotenv").config();
const { App, ExpressReceiver } = require("@slack/bolt");
const bodyParser = require("body-parser");
const logBunyan = require("@google-cloud/logging-bunyan");
const { slackMessageCreator, slackAcceptanceReplyCreator, smsMessageCreator, tinifyURL } = require("./util/templateFunctions");

const FS_ASSISTANT_CHANNEL = "C040SH1GX5Z";
const TWILIO_NUMBER = "+13157582817";
const BASE_URL = "https://fsl-hackathon-2022.uc.r.appspot.com";

async function StartServer() {
  const { logger, mw } = await logBunyan.express.middleware({
    logName: "fs-slack-assistant",
    projectId: process.env.NODE_ENV === "production" ? undefined : "fsl-hackathon-2022",
    keyFilename: process.env.NODE_ENV === "production" ? undefined : "key/fsl-hackathon-2022-639f41b28317.json",
    redirectToStdout: true
  });

  const receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET
  });
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

    try {
      const message = req.body[0];
      const name = message.name;
      const number = message.phoneNumber;
      const description = message.appointment.subject;
      const startTime = message.appointment.startTime;
      const endTime = message.appointment.endTime;
      const address = `${message.appointment.address.street} - ${message.appointment.address.city} - ${message.appointment.address.state} - ${message.appointment.address.postalCode} - ${message.appointment.address.country}`;
      const appointmentId = message.appointment.appointmentId;

      // Construct the original slack post to be sent to the channel
      const slackMessageBody = slackMessageCreator({
        name,
        description,
        startTime,
        endTime,
        address,
        appointmentId
      });

      const slackMessageResponse = await app.client.chat.postMessage({
        ...slackMessageBody,
        channel: FS_ASSISTANT_CHANNEL
      });

      const slackThreadID = slackMessageResponse.ts;

      // Construct the Accept/Decline buttons that will appear in the thread below the original post
      const slackAcceptanceButtons = slackAcceptanceReplyCreator({
        number,
        appointmentId,
        threadId: slackThreadID
      });

      app.client.chat.postMessage({
        ...slackAcceptanceButtons,
        channel: FS_ASSISTANT_CHANNEL,
        thread_ts: slackThreadID
      });

      // Construct the SMS Message and Accept/Decline Links
      const acceptURL = await tinifyURL(`${BASE_URL}/reply?appointmentId=${appointmentId}&number=${number}&threadId=${slackThreadID}&answer=ACCEPT`);
      const declineURL = await tinifyURL(
        `${BASE_URL}/reply?appointmentId=${appointmentId}&number=${number}&threadId=${slackThreadID}&answer=DECLINE`
      );

      const smsMessageBody = smsMessageCreator({
        description,
        startTime,
        endTime,
        address,
        appointmentId,
        acceptURL,
        declineURL
      });

      const responseTwilio = await twilioClient.messages.create({
        to: number,
        body: smsMessageBody,
        from: TWILIO_NUMBER
      });

      req.log.info("Twilio message sent", responseTwilio);
      res.writeHead(200);
      res.end("ok!");
    } catch (error) {
      req.log.error("Error sending to Twilio", error);
      res.writeHead(400);
      res.end("Error sending message:", error);
    }
  });

  receiver.router.get("/reply", async (req, res) => {
    const number = req.query.number;
    const threadId = req.query.threadId;
    const appointmentId = req.query.appointmentId;
    const answer = req.query.answer;

    try {
      if (answer === "ACCEPT") {
        // technician has accepted appointment
        onAcceptAppointment({ number, threadId, appointmentId });
      } else {
        // technician has declined appointment
        onDeclineAppointment({ number, threadId, appointmentId });
      }

      res.status(200).end("Success!");
    } catch (error) {
      res.status(400).end("Error receiving message");
    }
  });

  app.action("button_yes_click", async ({ body, ack, say }) => {
    // Acknowledge the action
    logger.info("'Yes' button clicked", body.message);
    // const payload = JSON.parse(body.message.actions[0].value);
    // const number = payload.number;
    // const appointmentId = payload.appointmentId;
    // const threadId = payload.threadId;
    // await say({
    //   text: "ok!",
    //   channel: FS_ASSISTANT_CHANNEL,
    //   thread_ts: threadId
    // });
    await ack();
    onAcceptAppointment({ number, appointmentId, threadId });
  });

  app.action("button_no_click", async ({ body, ack, say }) => {
    // Acknowledge the action
    logger.info("'No' button clicked", body.message);
    // const payload = JSON.parse(body.message.actions[0].value);
    // const number = payload.number;
    // const appointmentId = payload.appointmentId;
    // const threadId = payload.threadId;
    // await say({
    //   text: "ok!",
    //   channel: FS_ASSISTANT_CHANNEL,
    //   thread_ts: threadId
    // });
    await ack();
    onDeclineAppointment({ number, appointmentId, threadId });
  });

  const onAcceptAppointment = async ({ number, appointmentId, threadId }) => {
    const slackMessageResponse = await app.client.chat.postMessage({
      channel: FS_ASSISTANT_CHANNEL,
      text: `Technician with ph #${number} has accepted appointment #${appointmentId}`,
      thread_ts: threadId
    });

    logger.info("Appointment Accepted!");
  };

  const onDeclineAppointment = async ({ number, appointmentId, threadId }) => {
    const slackMessageResponse = await app.client.chat.postMessage({
      channel: FS_ASSISTANT_CHANNEL,
      text: `Technician with ph #${number} has accepted appointment #${appointmentId}`,
      thread_ts: threadId
    });

    logger.info("Appointment Declined!");
  };

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
