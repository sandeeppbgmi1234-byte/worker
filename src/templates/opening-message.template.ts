import type { OpeningMessageTemplateInput, MetaAttachment } from "./types";
import { QUICK_REPLIES } from "../config/instagram.config";

const DEFAULT_OPENING_MESSAGE =
  "Hi, nice to meet you. Press the button below and we will send you the content ✨.";
const DEFAULT_BUTTON_TEXT = "Send ✨";

export function buildOpeningMessageTemplate(
  input: OpeningMessageTemplateInput,
): MetaAttachment {
  const text = input.openingMessage || DEFAULT_OPENING_MESSAGE;
  const buttonText = input.openingButtonText || DEFAULT_BUTTON_TEXT;

  return {
    type: "template",
    payload: {
      template_type: "button",
      text,
      buttons: [
        {
          type: "postback",
          title: buttonText,
          payload: `${QUICK_REPLIES.OPENING_MESSAGE.PAYLOAD_PREFIX}${input.automationId}`,
        },
      ],
    },
  };
}
