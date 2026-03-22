import type {
  AskToFollowTemplateInput,
  MetaAttachment,
  TemplateButton,
} from "./types";
import { QUICK_REPLIES } from "../config/instagram.config";

const DEFAULT_ASK_TO_FOLLOW_MESSAGE =
  "You need to follow me first! Once you have, tap the button below. 😇";

export function buildAskToFollowTemplate(
  input: AskToFollowTemplateInput,
  automationId: string,
): MetaAttachment {
  const text = input.askToFollowMessage || DEFAULT_ASK_TO_FOLLOW_MESSAGE;

  const buttons: TemplateButton[] = [
    {
      type: "web_url",
      url: input.profileUrl,
      title: "Visit Profile",
    },
    {
      type: "postback",
      title: QUICK_REPLIES.FOLLOW_CONFIRM.TITLE,
      payload: `${QUICK_REPLIES.FOLLOW_CONFIRM.PAYLOAD_PREFIX}${automationId}`,
    },
  ];

  return {
    type: "template",
    payload: {
      template_type: "button",
      text,
      buttons,
    },
  };
}
