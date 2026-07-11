export interface SpecialistOutput {
  deliverableType: "text" | "schema";
  text?: string;
  schema?: Record<string, unknown>;
}

/** A specialist's actual job: turn the requester's requirements text into a deliverable. */
export type WorkFn = (requirements: string) => Promise<SpecialistOutput>;
