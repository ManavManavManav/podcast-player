import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEpisodes, getPodcast, PodcastIndexError, searchPodcasts } from "@/lib/server/podcastIndex";
import type { Podcast } from "@/lib/types";

const feed = {
  id: 42,
  title: "  Show  ",
  author: "",
  ownerName: "Owner",
  description: "<p>About &amp; more</p>",
  image: "https://img.example/small.jpg",
  artwork: "https://img.example/art.jpg",
  language: "en-US",
  categories: { 1: "History", 2: "Society" },
  episodeCount: 3,
  link: "https://show.example",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("PODCAST_INDEX_API_KEY", "KEY");
  vi.stubEnv("PODCAST_INDEX_API_SECRET", "SECRET");
  vi.stubEnv("PODCAST_INDEX_API_SECRET_BASE64", "");
  fetchMock = vi.fn(async () => Response.json({ feed }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Podcast Index client", () => {
  it("signs requests the way the API requires", async () => {
    await getPodcast(42);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://api.podcastindex.org/api/1.0/podcasts/byfeedid?id=42");
    const date = init.headers["X-Auth-Date"];
    expect(init.headers["X-Auth-Key"]).toBe("KEY");
    expect(init.headers.Authorization).toBe(crypto.createHash("sha1").update(`KEYSECRET${date}`).digest("hex"));
  });

  it("fails clearly without credentials", async () => {
    vi.stubEnv("PODCAST_INDEX_API_KEY", "");
    await expect(getPodcast(42)).rejects.toBeInstanceOf(PodcastIndexError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports API errors with their status", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));
    const err = await searchPodcasts("x").catch((e) => e);
    expect(err).toBeInstanceOf(PodcastIndexError);
    expect(err.status).toBe(401);
  });

  it("maps a feed to a podcast", async () => {
    expect(await getPodcast(42)).toEqual({
      id: 42,
      title: "Show",
      author: "Owner",
      description: "About & more",
      image: "https://img.example/art.jpg",
      language: "en-US",
      categories: ["History", "Society"],
      episodeCount: 3,
      link: "https://show.example",
    });
  });

  it("returns null for unknown feeds", async () => {
    fetchMock.mockResolvedValue(Response.json({ feed: [] }));
    expect(await getPodcast(7)).toBeNull();
  });

  it("maps episodes and drops ones without audio", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        items: [
          { id: 1, title: "Ep 1", enclosureUrl: "https://cdn.example/1.mp3", duration: 600, datePublished: 1700000000, feedId: 42, feedLanguage: "en" },
          { id: 2, title: "No audio", feedId: 42 },
          { id: 3, enclosureUrl: "https://cdn.example/3.mp3", duration: null, image: "https://img.example/3.jpg", feedId: 42 },
        ],
      }),
    );
    const podcast = { id: 42, title: "Show", image: "https://img.example/art.jpg", link: "https://show.example", language: "en-US" } as Podcast;
    const episodes = await getEpisodes(podcast);
    expect(episodes.map((e) => e.id)).toEqual([1, 3]);
    expect(episodes[0]).toMatchObject({ title: "Ep 1", duration: 600, image: "https://img.example/art.jpg", podcastTitle: "Show", podcastLink: "https://show.example", language: "en" });
    expect(episodes[1]).toMatchObject({ title: "Untitled episode", duration: 0, image: "https://img.example/3.jpg", language: "en-US" });
  });

  it.each(["javascript:alert(1)", "data:text/html,hi", "  JAVASCRIPT:alert(1)", "not a url"])(
    "drops a website link that isn't http(s): %s",
    async (link) => {
      fetchMock.mockResolvedValue(Response.json({ feed: { ...feed, link } }));
      expect((await getPodcast(42))?.link).toBe("");
    },
  );

  it("gives up on a request that doesn't answer within 8 s", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
      );
      const pending = searchPodcasts("slow").catch((e) => e);
      await vi.advanceTimersByTimeAsync(7_900);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(200);
      const err = await pending;
      expect(err).toBeInstanceOf(PodcastIndexError);
      expect(err.message).toMatch(/didn't answer/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("can be pointed at another server (for end-to-end tests)", async () => {
    vi.stubEnv("PODCAST_INDEX_BASE_URL", "http://127.0.0.1:4010/podcastindex/");
    await getPodcast(42);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:4010/podcastindex/podcasts/byfeedid?id=42");
  });
});
