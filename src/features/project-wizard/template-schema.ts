import { z } from "zod";

export const TemplateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});

export const TemplateSummaryListSchema = z.array(TemplateSummarySchema);

export type TemplateSummary = z.infer<typeof TemplateSummarySchema>;
