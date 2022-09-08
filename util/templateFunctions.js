const slackMessageCreator = ({
  name,
  description,
  startTime,
  endTime,
  address,
  appointmentId,
}) => {
  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*New Appointment Request for: ${name}*`,
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Description*: ${description}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Starting At*: ${startTime}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Ending At*: ${endTime}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Address*: ${address}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Appointment ID*: ${appointmentId}`,
        },
      },
    ],
  };
};

const slackAcceptanceReplyCreator = ({ number, appointmentId, threadId }) => {
  const payload = JSON.stringify({
    number,
    appointmentId,
    threadId,
  });

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Would you like to take on this appointment?  `,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Yes",
              emoji: true,
            },
            value: payload,
            style: "primary",
            action_id: "button_yes_click",
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "No",
              emoji: true,
            },
            value: payload,
            style: "danger",
            action_id: "button_no_click",
          },
        ],
      },
    ],
  };
};

const smsMessageCreator = ({
  description,
  startTime,
  endTime,
  address,
  appointmentId,
  acceptURL,
  declineURL,
}) => {
  return `You've been assigned a new appointment! \n
Description: ${description}\n
Starting at:${startTime}\n
Ending at: ${endTime}\n
Address: ${address}\n
Appointment Id: ${appointmentId} \n\n
To accept this appointment, click here: ${acceptURL} \n
To decline this appointment, click here: ${declineURL}`;
};

const tinifyURL = async (url) => {
  const prettylink = require("prettylink");
  const tinyurl = new prettylink.TinyURL(process.env.BITLY_AUTH_TOKEN);
  const shortenedURL = await tinyurl.short(url);
  return shortenedURL;
};

module.exports = {
  slackMessageCreator,
  slackAcceptanceReplyCreator,
  smsMessageCreator,
  tinifyURL,
};
