import { isServiceGalleryImagePath, safePriceMenuMediaUrl, safePublicMediaUrl } from './public-media-url';

describe('explicit display-menu subject-gallery allowlist', () => {
  test('allows exact versioned keys only for opted-in menu callers, including both key-length boundaries', () => {
    for (const key of ['a', 'body-massage', 'a1--z', 'a'.repeat(80)]) {
      const value = `/service-gallery/v1/${key}.webp`;
      expect(isServiceGalleryImagePath(value)).toBe(true);
      expect(safePriceMenuMediaUrl(value)).toBe(value);
      expect(safePublicMediaUrl(value)).toBeNull();
    }
    expect(isServiceGalleryImagePath('/service-gallery/v1/body-massage.webp\n')).toBe(false);
  });

  test('encoded paths, alternate versions and extensions, traversal and URL suffixes never become allowed relative media', () => {
    for (const value of [
      null, {}, 12, '/service-gallery/v1/.webp', `/service-gallery/v1/${'a'.repeat(81)}.webp`,
      '/service-gallery/v1/1body.webp', '/service-gallery/v1/Body.webp', '/service-gallery/v1/body_massage.webp',
      '/service-gallery/v2/body.webp', '/service-gallery/V1/body.webp', '/Service-gallery/v1/body.webp',
      '/service-gallery/v1/body.WEBP', '/service-gallery/v1/body.jpg', '/service-gallery/v1/body.webp?x=1',
      '/service-gallery/v1/body.webp#x', '/service-gallery/v1/body.webp?', '/service-gallery/v1/body.webp#',
      '/service-gallery/v1/%62ody.webp', '/service-gallery/v1/body%2fother.webp',
      '/service-gallery/v1/../body.webp', '/service-gallery/v1/body/../other.webp',
      '/service-gallery/v1/body.webp/other.webp', '/service-gallery/v1/body\\other.webp',
      '//evil.invalid/service-gallery/v1/body.webp', 'service-gallery/v1/body.webp', '/other/body.webp',
      '/service-gallery/v1/body\nother.webp',
    ]) {
      expect(isServiceGalleryImagePath(value)).toBe(false);
      expect(safePriceMenuMediaUrl(value)).toBeNull();
      expect(safePublicMediaUrl(value)).toBeNull();
    }
  });

  test('both scopes retain existing managed/HTTPS rules and reject alternate protocols or credential-bearing URLs', () => {
    const managed = '/api/v1/upload/media/11111111-1111-4111-8111-111111111111/file';
    for (const validator of [safePublicMediaUrl, safePriceMenuMediaUrl]) {
      expect(validator(managed)).toBe(managed);
      expect(validator('https://cdn.example.invalid/photo.webp')).toBe('https://cdn.example.invalid/photo.webp');
      for (const value of ['http://cdn.example.invalid/photo.webp', 'data:image/webp;base64,x', 'javascript:alert(1)', 'https://user:password@cdn.example.invalid/photo.webp', managed + '?token=x', managed + '#x']) {
        expect(validator(value)).toBeNull();
      }
    }
  });
});
