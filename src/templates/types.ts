// The shape of a fully-constructed Meta Send API request body
export interface MetaSendMessagePayload {
  recipient: { comment_id: string } | { id: string };
  message: MetaMessageContent;
  messaging_type: "RESPONSE";
  access_token: string;
}

// The "message" field inside the send payload
export type MetaMessageContent =
  | { text: string }
  | { attachment: MetaAttachment };

export interface MetaAttachment {
  type: "template" | "image";
  payload: GenericTemplatePayload | ButtonTemplatePayload;
}

export interface GenericTemplatePayload {
  template_type: "generic";
  elements: GenericTemplateElement[];
}

export interface GenericTemplateElement {
  title: string;
  image_url?: string;
  subtitle?: string;
  default_action?: {
    type: "web_url";
    url: string;
  };
  buttons?: TemplateButton[];
}

export interface ButtonTemplatePayload {
  template_type: "button";
  text: string;
  buttons: TemplateButton[];
}

export type TemplateButton =
  | { type: "web_url"; url: string; title: string }
  | { type: "postback"; title: string; payload: string };

// Input type for the DM Reply template builder
export interface DmReplyTemplateInput {
  replyMessage: string | null;
  replyImage: string | null;
  dmLinks: Array<{ title: string; url: string }>;
}

// Input type for the Ask To Follow template builder
export interface AskToFollowTemplateInput {
  askToFollowMessage: string | null;
  profileUrl: string;
}

// Input type for the Opening Message template builder
export interface OpeningMessageTemplateInput {
  openingMessage: string | null;
  openingButtonText: string | null;
  automationId: string;
}
