import test from "node:test";
import assert from "node:assert/strict";
import { inferResourceTypeFromUrl } from "../shared/resource-detection.js";

test("detects YouTube watch URLs as videos", () => {
  assert.equal(
    inferResourceTypeFromUrl("https://www.youtube.com/watch?v=SLTxclhJgmI"),
    "youtube_video"
  );
});

test("detects YouTube shorts and live URLs as videos", () => {
  assert.equal(inferResourceTypeFromUrl("https://youtube.com/shorts/abc123"), "youtube_video");
  assert.equal(inferResourceTypeFromUrl("https://youtube.com/live/abc123"), "youtube_video");
});

test("detects youtu.be URLs as videos", () => {
  assert.equal(inferResourceTypeFromUrl("https://youtu.be/abc123"), "youtube_video");
});

test("detects YouTube channel URL styles as channels", () => {
  assert.equal(inferResourceTypeFromUrl("https://youtube.com/@3blue1brown"), "youtube_channel");
  assert.equal(
    inferResourceTypeFromUrl("https://www.youtube.com/channel/UCYO_jab_esuFRV4b17AJtAw"),
    "youtube_channel"
  );
  assert.equal(inferResourceTypeFromUrl("https://youtube.com/c/3blue1brown"), "youtube_channel");
  assert.equal(inferResourceTypeFromUrl("https://youtube.com/user/someone"), "youtube_channel");
});

test("detects normal pages as webpages", () => {
  assert.equal(inferResourceTypeFromUrl("https://example.com/article"), "webpage");
});
