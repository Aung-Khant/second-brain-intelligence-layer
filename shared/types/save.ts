import type { ResourceType, SaveIntent } from "./resource.js";

export type ConfirmedResource = {
  name: string;
  url: string;
  resourceType: ResourceType;
  description?: string;
  summary?: string;
  areaIds: string[];
  topicIds: string[];
  projectIds: string[];
  saveIntent: SaveIntent;
  whySaved?: string;
};

export type SaveResourceResult =
  | {
      status: "saved";
      resourceId: string;
      resourceUrl: string;
    }
  | {
      status: "duplicate";
      resourceId: string;
      resourceUrl: string;
    };

