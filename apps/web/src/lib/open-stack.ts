/** The row of a model on the Open Stack page, and the link to it from a caption. */
export const stackAnchor = (modelId: string) => `model-${modelId}`;
export const stackHref = (modelId: string) => `/open-stack#${stackAnchor(modelId)}`;
