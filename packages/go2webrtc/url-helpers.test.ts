import { describe, expect, it } from "vitest";
import { buildRtcConnectionUrl, parseConnectionString } from "./url-helpers";

describe("url-helpers", () => {
  describe("parseConnectionString", () => {
    it("should parse webtorrent urls", () => {
      const url = "webtorrent:?share=test&pwd=test";
      const result = parseConnectionString(url);
      expect(result).toEqual({
        share: "test",
        pwd: "test",
        type: "webtorrent",
      });
    });
    it("should parse webrtc urls", () => {
      const url = "webrtc:?share=ts&pwd=tp";
      const result = parseConnectionString(url);
      expect(result).toEqual({
        share: "ts",
        pwd: "tp",
        type: "webrtc",
      });
    });
    it("should parse webcam urls", () => {
      const url = "webcam:?deviceId=123";
      const result = parseConnectionString(url);
      expect(result).toEqual({
        type: "webcam",
        deviceId: "123",
      });
    });
    it("should parse webcam urls with ideal dimensions", () => {
      const url = "webcam:?deviceId=123&width=1024&height=768";
      const result = parseConnectionString(url);
      expect(result).toEqual({
        type: "webcam",
        deviceId: "123",
        idealWidth: 1024,
        idealHeight: 768,
      });
    });
    it("should parse url urls", () => {
      const url = "https://example.com";
      const result = parseConnectionString(url);
      expect(result).toEqual({
        type: "url",
        url: url,
      });
    });
    it("should throw an error for invalid urls", () => {
      expect(() => parseConnectionString("invalid:url")).toThrow();
    });
  });
  describe("buildConnectionUrl", () => {
    it("should build webtorrent urls", () => {
      const url = buildRtcConnectionUrl({
        share: "test",
        pwd: "test",
        type: "webtorrent",
      });
      expect(url).toEqual("webtorrent:?share=test&pwd=test");
    });
  });
});
