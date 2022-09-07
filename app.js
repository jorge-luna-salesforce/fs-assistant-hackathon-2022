require("dotenv").config();
const { App, ExpressReceiver } = require("@slack/bolt");
const bodyParser = require("body-parser");

const FS_ASSISTANT_CHANNEL = "C040SH1GX5Z";

const receiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET });
receiver.router.use(bodyParser.json());
receiver.router.use(bodyParser.urlencoded({ extended: true }));

const app = new App({
  receiver,
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000
});

receiver.router.get("/ping", (req, res) => {
  res.writeHead(200);
  res.end("Pong!");
});

receiver.router.post("/schedule-wo", (req, res) => {
  app.client.chat.postMessage({
    text: "API Call received with data => " + req.body.data,
    channel: FS_ASSISTANT_CHANNEL
  });

  res.writeHead(200);
  res.end("ok!");
});

// Listens to incoming messages that contain "hello"
app.message("hello", async ({ message, say }) => {
  await say({
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Hey there <@${message.user}> ===>  `
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: "Click Me"
          },
          action_id: "button_click"
        }
      }
    ],
    text: `Hey there <@${message.user}>!`
  });
});

app.action("button_click", async ({ body, ack, say }) => {
  // Acknowledge the action
  await ack();
  await say(`<@${body.user.id}> clicked the button`);
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log("Slack Bot FS Assistant is running!");
})();
