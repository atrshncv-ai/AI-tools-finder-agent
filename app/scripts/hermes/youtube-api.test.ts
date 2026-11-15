/**
 * youtube-api.test.ts — YouTube Data API v3 ingestion.
 *
 * The network is a stubbed global `fetch`: the suite proves the request shape,
 * response parsing, the no-key refusal, the dedicated quota error class and the
 * exact `news` row contract (canonical watch URL, `youtube-<handle>` source,
 * channel language, status pending).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSection } from "../../api/lib/section-resolve";
import { buildNewsRow, buildYoutubeApiCandidate, collectYouTubeApi } from "./collect-dual";
import { YOUTUBE_SOURCES } from "./youtube-sources";
import {
  YouTubeQuotaError,
  listUploads,
  listVideoDurations,
  parseIso8601Duration,
  resolveChannel,
  watchUrl,
  youtubeApiKey,
} from "./youtube-api";

const UPLOADED_AT = "2026-11-14T09:00:00Z";
const ADDED_TO_PLAYLIST_AT = "2026-11-14T10:00:00Z";

const CHANNEL_RESPONSE = {
  items: [
    {
      id: "UCbfYPyITQ-7l4upoX8nvctg",
      snippet: { title: "Two Minute Papers" },
      contentDetails: { relatedPlaylists: { uploads: "UUbfYPyITQ-7l4upoX8nvctg" } },
    },
  ],
};

const PLAYLIST_RESPONSE = {
  items: [
    {
      snippet: {
        title: "A video about AI",
        description: "The lead paragraph.",
        publishedAt: ADDED_TO_PLAYLIST_AT,
      },
      contentDetails: { videoId: "vidA", videoPublishedAt: UPLOADED_AT },
    },
    {
      // Deleted/private entries have no usable title — they must be skipped.
      snippet: { title: "", description: "" },
      contentDetails: { videoId: "vidB" },
    },
  ],
};

function apiResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("YOUTUBE_API_KEY", "test-key");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveChannel", () => {
  it("turns a handle into the channel id and its uploads playlist", async () => {
    fetchMock.mockResolvedValue(apiResponse(CHANNEL_RESPONSE));

    const channel = await resolveChannel("@TwoMinutePapers");

    expect(channel).toEqual({
      channelId: "UCbfYPyITQ-7l4upoX8nvctg",
      title: "Two Minute Papers",
      uploadsPlaylistId: "UUbfYPyITQ-7l4upoX8nvctg",
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://youtube.googleapis.com/youtube/v3/channels",
    );
    expect(url.searchParams.get("part")).toBe("contentDetails,snippet");
    expect(url.searchParams.get("forHandle")).toBe("@TwoMinutePapers");
    expect(url.searchParams.get("key")).toBe("test-key");
  });

  it("normalizes a handle passed without the leading @", async () => {
    fetchMock.mockResolvedValue(apiResponse(CHANNEL_RESPONSE));

    await resolveChannel("TwoMinutePapers");

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("forHandle")).toBe("@TwoMinutePapers");
  });

  it("returns null for an unknown handle instead of throwing", async () => {
    fetchMock.mockResolvedValue(apiResponse({ items: [] }));

    await expect(resolveChannel("@no-such-channel")).resolves.toBeNull();
  });
});

describe("listUploads", () => {
  it("parses playlist items and prefers the upload date over the playlist date", async () => {
    fetchMock.mockResolvedValue(apiResponse(PLAYLIST_RESPONSE));

    const uploads = await listUploads("UUbfYPyITQ-7l4upoX8nvctg", 5);

    expect(uploads).toEqual([
      {
        videoId: "vidA",
        title: "A video about AI",
        description: "The lead paragraph.",
        publishedAt: new Date(UPLOADED_AT),
      },
    ]);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://youtube.googleapis.com/youtube/v3/playlistItems",
    );
    expect(url.searchParams.get("part")).toBe("snippet,contentDetails");
    expect(url.searchParams.get("playlistId")).toBe("UUbfYPyITQ-7l4upoX8nvctg");
    expect(url.searchParams.get("maxResults")).toBe("5");
  });

  it("clamps maxResults into the API range 1..50", async () => {
    fetchMock.mockResolvedValue(apiResponse({ items: [] }));

    await listUploads("UUx", 500);
    await listUploads("UUx", 0);

    const limits = fetchMock.mock.calls.map((call) =>
      new URL(String(call[0])).searchParams.get("maxResults"),
    );
    expect(limits).toEqual(["50", "1"]);
  });
});

describe("listVideoDurations", () => {
  it("maps video ids to duration seconds", async () => {
    fetchMock.mockResolvedValue(
      apiResponse({
        items: [
          { id: "a", contentDetails: { duration: "PT12M34S" } },
          { id: "b", contentDetails: { duration: "PT1H" } },
        ],
      }),
    );

    const durations = await listVideoDurations(["a", "b"]);

    expect(durations?.get("a")).toBe(754);
    expect(durations?.get("b")).toBe(3600);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("part")).toBe("contentDetails");
    expect(url.searchParams.get("id")).toBe("a,b");
  });

  it("parses ISO 8601 durations permissively and rejects garbage", () => {
    expect(parseIso8601Duration("PT30S")).toBe(30);
    expect(parseIso8601Duration("PT1H2M3S")).toBe(3723);
    expect(parseIso8601Duration("P1DT2H")).toBe(93_600);
    expect(parseIso8601Duration("")).toBeNull();
    expect(parseIso8601Duration("not-a-duration")).toBeNull();
  });
});

describe("missing API key", () => {
  it("returns null from every call and never touches the network", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "  ");

    expect(youtubeApiKey()).toBeNull();
    await expect(resolveChannel("@Xenon_Lab")).resolves.toBeNull();
    await expect(listUploads("UUx", 3)).resolves.toBeNull();
    await expect(listVideoDurations(["a"])).resolves.toBeNull();
    await expect(collectYouTubeApi({ recordHealth: vi.fn(async () => {}) })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("HTTP failures", () => {
  it("maps a 403 quotaExceeded response to YouTubeQuotaError", async () => {
    fetchMock.mockResolvedValue(
      apiResponse(
        {
          error: {
            code: 403,
            message: "The request cannot be completed because you have exceeded your quota.",
            errors: [{ reason: "quotaExceeded" }],
          },
        },
        403,
      ),
    );

    const error = await resolveChannel("@TwoMinutePapers").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(YouTubeQuotaError);
    expect(error).toBeInstanceOf(Error);
    expect((error as YouTubeQuotaError).name).toBe("YouTubeQuotaError");
    expect((error as YouTubeQuotaError).status).toBe(403);
  });

  it("returns null for a non-quota failure so the legacy path can run", async () => {
    fetchMock.mockResolvedValue(apiResponse({ error: { code: 500, message: "backend error" } }, 500));

    await expect(resolveChannel("@TwoMinutePapers")).resolves.toBeNull();
    await expect(listUploads("UUx", 3)).resolves.toBeNull();
  });
});

describe("collectYouTubeApi", () => {
  it("collects every configured channel through the API when a key is set", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = new URL(String(input));
      const handle = url.searchParams.get("forHandle") ?? "";
      if (url.pathname.endsWith("/channels")) {
        return apiResponse({
          items: [
            {
              id: `UC-${handle.slice(1)}`,
              snippet: { title: handle },
              contentDetails: { relatedPlaylists: { uploads: `UU-${handle.slice(1)}` } },
            },
          ],
        });
      }
      if (url.pathname.endsWith("/playlistItems")) {
        const videoId = `vid-${(url.searchParams.get("playlistId") ?? "").slice(3)}`;
        return apiResponse({
          items: [
            {
              snippet: {
                title: `Video ${videoId}`,
                description: "Lead text",
                publishedAt: ADDED_TO_PLAYLIST_AT,
              },
              contentDetails: { videoId, videoPublishedAt: UPLOADED_AT },
            },
          ],
        });
      }
      if (url.pathname.endsWith("/videos")) {
        const ids = (url.searchParams.get("id") ?? "").split(",").filter(Boolean);
        return apiResponse({
          items: ids.map((id) => ({ id, contentDetails: { duration: "PT10M" } })),
        });
      }
      throw new Error(`unexpected request ${url}`);
    });
    const health = vi.fn(async () => {});

    const candidates = await collectYouTubeApi({ recordHealth: health });

    expect(candidates).not.toBeNull();
    expect(candidates).toHaveLength(YOUTUBE_SOURCES.length);
    for (const [index, source] of YOUTUBE_SOURCES.entries()) {
      const candidate = candidates![index]!;
      expect(candidate.url).toBe(`https://www.youtube.com/watch?v=vid-${source.handle.slice(1)}`);
      expect(candidate.source).toBe(source.name);
      expect(candidate.language).toBe(source.language);
      expect(candidate.description).toBe("Lead text");
      expect(candidate.publishedAt).toEqual(new Date(UPLOADED_AT));
      expect(candidate.metrics).toMatchObject({
        origin: "youtube-api",
        durationSeconds: 600,
      });
    }
    expect(health).toHaveBeenCalledTimes(YOUTUBE_SOURCES.length);
    expect(health.mock.calls.every((call) => call[2] === true)).toBe(true);
  });

  it("falls back to the legacy path as soon as the quota is exhausted", async () => {
    fetchMock.mockResolvedValue(
      apiResponse({ error: { code: 403, errors: [{ reason: "quotaExceeded" }] } }, 403),
    );

    await expect(
      collectYouTubeApi({ recordHealth: vi.fn(async () => {}) }),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("database row contract", () => {
  it("builds the canonical watch URL, youtube-<handle> source and pending row", () => {
    const source = YOUTUBE_SOURCES.find((candidate) => candidate.handle === "@vladimiraidev")!;
    const candidate = buildYoutubeApiCandidate(
      source,
      {
        videoId: "dQw4w9WgXcQ",
        title: "Новый ИИ-инструмент",
        description: "Краткое описание",
        publishedAt: new Date("2026-11-15T09:00:00Z"),
      },
      615,
    );
    const resolution = resolveSection({
      title: candidate.title,
      description: candidate.description,
    });

    expect(candidate.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(candidate.source).toBe("youtube-vladimir-ai-dev");
    expect(candidate.language).toBe("ru");
    expect(watchUrl("dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    const row = buildNewsRow(candidate, resolution);
    expect(row.originalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(row.source).toBe("youtube-vladimir-ai-dev");
    expect(row.language).toBe("ru");
    expect(row.status).toBe("pending");
    expect(row.summary).toBe("Краткое описание");
    expect(row.section).toBe(resolution.section);
    expect(row.isScience).toBe(resolution.isScience);
    expect(row.metrics).toMatchObject({ origin: "youtube-api", videoId: "dQw4w9WgXcQ", durationSeconds: 615 });
  });
});
