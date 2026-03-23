import type {
  DmReplyTemplateInput,
  MetaAttachment,
  GenericTemplateElement,
} from "./types";

const DEFAULT_TITLE = "Here you go! ✨";
const TITLE_MAX_LENGTH = 80;

export function buildDmReplyTemplate(
  input: DmReplyTemplateInput,
): MetaAttachment {
  const { replyMessage, replyImage, dmLinks } = input;

  const element: GenericTemplateElement = {
    title: DEFAULT_TITLE,
  };

  // Title / Subtitle logic
  if (replyMessage) {
    if (replyMessage.length <= TITLE_MAX_LENGTH) {
      element.title = replyMessage;
    } else {
      // Long messages go into subtitle, title stays short
      element.title = DEFAULT_TITLE;
      element.subtitle = replyMessage.slice(0, 80); // Meta caps subtitle at 80 chars
    }
  }

  // Image
  if (replyImage) {
    element.image_url = replyImage;
  }

  // Buttons (max 3 per Meta API)
  if (dmLinks.length > 0) {
    element.buttons = dmLinks.slice(0, 3).map((link) => ({
      type: "web_url" as const,
      url: link.url,
      title: link.title,
    }));
  }

  // If image exists and there are links, set default_action to first link
  if (replyImage && dmLinks.length > 0) {
    element.default_action = {
      type: "web_url",
      url: dmLinks[0].url,
    };
  }

  return {
    type: "template",
    payload: {
      template_type: "generic",
      elements: [element],
    },
  };
}
