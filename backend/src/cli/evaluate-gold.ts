import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { classifyResource } from "../ai/classify-resource.js";
import { mockTaxonomy } from "../retrieval/mock-taxonomy.js";
import type { ResourceType } from "../../../shared/types/resource.js";

type GoldFixture = {
  resource: {
    title: string;
    url?: string;
    type: ResourceType;
    creator?: string;
    description?: string;
    visibleText?: string;
  };
  expected: {
    areas: string[];
    topics: string[];
    projects: string[];
  };
};

type RelationshipKind = keyof GoldFixture["expected"];

const datasetDir = join(process.cwd(), "tests", "gold-dataset");
const files = (await readdir(datasetDir)).filter((file) => file.endsWith(".json")).sort();
const results = [];

for (const file of files) {
  const fixture = JSON.parse(await readFile(join(datasetDir, file), "utf8")) as GoldFixture;
  const classified = classifyResource({
    resource: fixture.resource,
    taxonomy: mockTaxonomy
  });

  const result = {
    file,
    areas: compareRelationshipSet(fixture.expected.areas, classified.areas.map((item) => item.entityName)),
    topics: compareRelationshipSet(fixture.expected.topics, classified.topics.map((item) => item.entityName)),
    projects: compareRelationshipSet(
      fixture.expected.projects,
      classified.projects.map((item) => item.entityName)
    )
  };

  results.push(result);
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);

function compareRelationshipSet(expected: string[], actual: string[]) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);

  return {
    expectedFound: expected.filter((name) => actualSet.has(name)),
    expectedMissed: expected.filter((name) => !actualSet.has(name)),
    unexpectedAdded: actual.filter((name) => !expectedSet.has(name))
  };
}

