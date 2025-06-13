import { describe, expect, it } from 'vitest';
import { buildConnectionUrl, parseConnectionString } from './url-helpers';

describe('url-helpers', () => {
  describe('parseConnectionString', () => {
    it('should parse webtorrent urls', () => {
      const url = 'webtorrent:?share=test&pwd=test';
      const result = parseConnectionString(url);
      expect(result).toEqual({
        share: 'test',
        pwd: 'test',
        type: 'webtorrent',
      });
    });
    it('should parse webrtc urls', () => {
      const url = 'webrtc:?accessToken=token123';
      const result = parseConnectionString(url);
      expect(result).toEqual({
        accessToken: 'token123',
        type: 'webrtc',
      });
    });
    it('should parse go2rtc urls', () => {
      const url = 'go2rtc:?host=localhost:1984&src=camera1';
      const result = parseConnectionString(url);
      expect(result).toEqual({
        type: 'go2rtc',
        host: 'localhost:1984',
        src: 'camera1',
      });
    });
    it('should parse webcam urls', () => {
      const url = 'webcam:?deviceId=123';

      const result = parseConnectionString(url);
      expect(result).toEqual({
        type: 'webcam',
        deviceId: '123',
      });
    });
    it('should parse webcam urls with ideal dimensions', () => {
      const url = 'webcam:?deviceId=123&width=1024&height=768';
      const result = parseConnectionString(url);
      expect(result).toEqual({
        type: 'webcam',
        deviceId: '123',
        idealWidth: 1024,
        idealHeight: 768,
      });
    });
    it('should parse url urls', () => {
      const url = 'https://example.com';
      const result = parseConnectionString(url);
      expect(result).toEqual({
        type: 'url',
        url: url,
      });
    });
    it('should throw an error for invalid urls', () => {
      expect(() => parseConnectionString('invalid:url')).toThrow();
    });
  });
  describe('buildConnectionUrl', () => {
    it('should build webtorrent urls', () => {
      const url = buildConnectionUrl({
        share: 'test',
        pwd: 'test',
        type: 'webtorrent',
      });
      expect(url).toEqual('webtorrent:?share=test&pwd=test');
    });
    it('should build webrtc urls', () => {
      const url = buildConnectionUrl({
        type: 'webrtc',
        accessToken: 'abc',
      });
      expect(url).toEqual('webrtc:?accessToken=abc');
    });
    it('should build webcam urls', () => {
      const url = buildConnectionUrl({
        type: 'webcam',
        idealWidth: 1024,
        deviceId: '123',
      });
      expect(url).toEqual('webcam:?deviceId=123&width=1024');
    });
    it('should build go2rtc urls', () => {
      const url = buildConnectionUrl({
        type: 'go2rtc',
        host: 'localhost:1984',
        src: 'camera1',
      });
      expect(url).toEqual('go2rtc:?host=localhost%3A1984&src=camera1');
    });
  });
});
