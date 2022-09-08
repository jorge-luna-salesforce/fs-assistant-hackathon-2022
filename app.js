require("dotenv").config();
const { App, ExpressReceiver } = require("@slack/bolt");
const bodyParser = require("body-parser");
const logBunyan = require("@google-cloud/logging-bunyan");
const fetch = require("node-fetch");
const { slackMessageCreator, slackAcceptanceReplyCreator, smsMessageCreator, tinifyURL } = require("./util/templateFunctions");

const FS_ASSISTANT_CHANNEL = "C040SH1GX5Z";
const TWILIO_NUMBER = "+13157582817";
const BASE_URL = "https://fsl-hackathon-2022.uc.r.appspot.com";
const SF_INSTANCE_URL = `https://brave-raccoon-k687wz-dev-ed.my.salesforce.com/services/apexrest/Appointment/`;

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
        await onAcceptAppointment({ number, threadId, appointmentId });
      } else {
        // technician has declined appointment
        await onDeclineAppointment({ number, threadId, appointmentId });
      }

      res.status(200).end("Success!");
    } catch (error) {
      res.status(400).end("Error receiving message");
    }
  });

  app.action("button_yes_click", async ({ body, ack, say }) => {
    // Acknowledge the action
    const payload = JSON.parse(body.message.blocks.filter((b) => b.type === "actions")[0].elements[0].value);
    logger.info("'Yes' button clicked", payload);
    await say({
      text: "ok!",
      channel: FS_ASSISTANT_CHANNEL,
      thread_ts: payload.threadId
    });
    await ack();
    await onAcceptAppointment(payload);
  });

  app.action("button_no_click", async ({ body, ack, say }) => {
    // Acknowledge the action
    const payload = JSON.parse(body.message.blocks.filter((b) => b.type === "actions")[0].elements[0].value);
    logger.info("'No' button clicked", payload);
    await say({
      text: "ok!",
      channel: FS_ASSISTANT_CHANNEL,
      thread_ts: payload.threadId
    });
    await ack();
    await onDeclineAppointment(payload);
  });

  const onAcceptAppointment = async ({ number, appointmentId, threadId }) => {
    if (appointmentId) {
      const statusUpdateResp = await updateAppointmentStatus(appointmentId, `Accepted By Technician`);
      if (statusUpdateResp.status === "Success") {
        await app.client.chat.postMessage({
          channel: FS_ASSISTANT_CHANNEL,
          text: `Technician with ph #${number} has accepted appointment #${appointmentId}`,
          thread_ts: threadId
        });
        logger.info("Appointment Accepted!");
      } else {
        await app.client.chat.postMessage({
          channel: FS_ASSISTANT_CHANNEL,
          text: `Cannot update status!`,
          thread_ts: threadId
        });
        logger.info("Cannot Accept Appointment!");
      }
    }
  };

  const onDeclineAppointment = async ({ number, appointmentId, threadId }) => {
    if (appointmentId) {
      const statusUpdateResp = await updateAppointmentStatus(appointmentId, `Declined By Technician`);
      if (statusUpdateResp === "Success") {
        await app.client.chat.postMessage({
          channel: FS_ASSISTANT_CHANNEL,
          text: `Technician with ph #${number} has declined appointment #${appointmentId}`,
          thread_ts: threadId
        });
        logger.info("Appointment Declined!");
      } else {
        await app.client.chat.postMessage({
          channel: FS_ASSISTANT_CHANNEL,
          text: `Cannot update status!`,
          thread_ts: threadId
        });
        logger.info("Cannot Decline Appointment!");
      }
    }
  };

  const updateAppointmentStatus = async (appointmentId, appointmentStatus) => {
    logger.info(`Inside updateAppointmentStatus`);
    const headers = {
      Authorization: "Bearer " + process.env.SF_AUTH_TOKEN,
      "Content-Type": "application/json"
    };

    try {
      const requestBody = { id: appointmentId, status: appointmentStatus };
      const body = JSON.stringify(requestBody);
      const response = await fetch(SF_INSTANCE_URL, {
        method: "PATCH",
        headers,
        body
      });
      const resp = await response.json();
      logger.info("Status update response : ", resp);
      return resp;
    } catch (err) {
      logger.error("Appointment status update failed.", err);
      throw err;
    }
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
