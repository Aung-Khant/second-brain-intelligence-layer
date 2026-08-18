// The Second Brain's existing structure as read from Notion (or from
// mock-taxonomy.ts). `definition`/`goal` are the free-text fields the local
// matcher scores resource text against - see classify-relations.ts.
export type Area = {
  id: string;
  name: string;
  definition?: string;
};

export type Topic = {
  id: string;
  name: string;
  definition?: string;
  areas?: string[];
};

export type ProjectStatus = "active" | "completed" | "archived";

export type Project = {
  id: string;
  name: string;
  goal?: string;
  areas?: string[];
  topics?: string[];
  problem?: string;
  audience?: string;
  status?: ProjectStatus;
};

export type Taxonomy = {
  areas: Area[];
  topics: Topic[];
  projects: Project[];
};

