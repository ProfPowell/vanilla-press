import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as openverse from '../../src/services/image-sources/openverse.js';
import * as pexels from '../../src/services/image-sources/pexels.js';
import * as pixabay from '../../src/services/image-sources/pixabay.js';
import * as unsplash from '../../src/services/image-sources/unsplash.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/image-sources');
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));
const UTM = 'utm_source=vanilla_press&utm_medium=referral';

describe('openverse adapter', () => {
  it('request: the exact URL, no auth', () => {
    const { url, headers } = openverse.request('red fox', { page: 2 });
    assert.equal(url, 'https://api.openverse.org/v1/images/?q=red%20fox&page=2&page_size=20&license=by,cc0,pdm&mature=false');
    assert.equal(new URL(url).searchParams.get('license'), 'by,cc0,pdm');
    assert.deepEqual(headers, {});
  });

  it('normalize: a CC BY item and a cc0 item', () => {
    const { results, hasMore } = openverse.normalize(fixture('openverse'), { page: 1 });
    assert.equal(hasMore, true);
    assert.deepEqual(results[0], {
      source: 'openverse',
      id: '4bc43a04-ef46-4544-a0c1-63c63f56e276',
      mode: 'copy',
      thumb: 'https://api.openverse.org/v1/images/4bc43a04-ef46-4544-a0c1-63c63f56e276/thumb/',
      url: 'https://live.staticflickr.com/65535/12345_abc_b.jpg',
      width: 1024,
      height: 683,
      description: 'Red fox in the snow',
      credit: {
        name: 'Jane Doe',
        url: 'https://www.flickr.com/photos/jdoe',
        site: 'Flickr',
        siteUrl: 'https://www.flickr.com/photos/jdoe/12345/',
        license: 'CC BY 2.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
      },
    });
    const cc0 = results[1];
    assert.equal(cc0.width, 6000);
    assert.equal(cc0.height, 4000);
    // An empty license (and so an empty licenseUrl) is left out of the credit.
    assert.equal(cc0.credit.license ?? '', '');
    assert.deepEqual(cc0.credit, {
      site: 'Wikimedia Commons',
      siteUrl: 'https://commons.wikimedia.org/w/index.php?curid=998877',
    });
  });

  it('normalize: drops an item with no url', () => {
    const json = fixture('openverse');
    json.results[0].url = null;
    assert.deepEqual(openverse.normalize(json, { page: 1 }).results.map((r) => r.id), ['9f2c1d8e-0000-4a5b-9c7d-112233445566']);
  });

  it('normalize: drops any result whose license is not by, cc0 or pdm', () => {
    const json = fixture('openverse');
    const base = json.results[0];
    json.results = ['by', 'cc0', 'pdm', 'by-sa', 'by-nc', 'by-nd', 'by-nc-sa', 'sampling+', undefined]
      .map((license, i) => ({ ...base, id: `id-${i}`, license }));
    assert.deepEqual(openverse.normalize(json, { page: 1 }).results.map((r) => r.id), ['id-0', 'id-1', 'id-2']);
  });

  it('normalize: the last page has no more', () => {
    const json = { ...fixture('openverse'), page: 12 };
    assert.equal(openverse.normalize(json, { page: 12 }).hasMore, false);
  });
});

describe('pexels adapter', () => {
  it('request: the exact URL and Authorization header', () => {
    const { url, headers } = pexels.request('fox', { page: 3, key: 'PX-KEY' });
    assert.equal(url, 'https://api.pexels.com/v1/search?query=fox&page=3&per_page=20');
    assert.deepEqual(headers, { Authorization: 'PX-KEY' });
  });

  it('normalize: large2x sized as 940x650 CSS px at 2x', () => {
    const { results, hasMore } = pexels.normalize(fixture('pexels'), { page: 1 });
    assert.equal(hasMore, true);
    assert.deepEqual(results[0], {
      source: 'pexels',
      id: '2014422',
      mode: 'copy',
      thumb: 'https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?auto=compress&cs=tinysrgb&h=350',
      url: 'https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
      width: 1300,
      height: 1300,
      description: 'Brown fox on snow field',
      credit: {
        name: 'Joey Farina',
        url: 'https://www.pexels.com/@joey',
        site: 'Pexels',
        siteUrl: 'https://www.pexels.com/photo/brown-fox-2014422/',
      },
    });
    assert.equal(results[1].width, 1880);
    assert.equal(results[1].height, 1253);
    assert.equal(results[1].description, '');
  });

  it('normalize: drops a photo with no large2x', () => {
    const json = fixture('pexels');
    delete json.photos[0].src;
    assert.deepEqual(pexels.normalize(json, { page: 1 }).results.map((r) => r.id), ['3000001']);
  });

  it('normalize: no next_page means no more', () => {
    const { next_page, ...json } = fixture('pexels');
    assert.equal(pexels.normalize(json, { page: 1 }).hasMore, false);
  });
});

describe('pixabay adapter', () => {
  it('request: the exact URL with the key', () => {
    const { url, headers } = pixabay.request('yellow flower', { page: 1, key: 'PB-KEY' });
    assert.equal(url, 'https://pixabay.com/api/?key=PB-KEY&q=yellow%20flower&page=1&per_page=20&image_type=photo&safesearch=true');
    assert.deepEqual(headers, {});
  });

  it('normalize: largeImageURL sized to its 1280px long edge', () => {
    const { results, hasMore } = pixabay.normalize(fixture('pixabay'), { page: 1 });
    assert.equal(hasMore, true);
    assert.deepEqual(results[0], {
      source: 'pixabay',
      id: '195893',
      mode: 'copy',
      thumb: 'https://pixabay.com/get/35bbf209e13e39d2_640.jpg',
      url: 'https://pixabay.com/get/ed6a99fd0a76647_1280.jpg',
      width: 1280,
      height: 720,
      description: 'blossom, bloom, flower',
      credit: {
        name: 'Josch13',
        url: 'https://pixabay.com/users/Josch13-48777/',
        site: 'Pixabay',
        siteUrl: 'https://pixabay.com/en/blossom-bloom-flower-195893/',
      },
    });
    // Smaller than 1280: not scaled up.
    assert.equal(results[1].width, 800);
    assert.equal(results[1].height, 1200);
  });

  it('normalize: no creator URL without both user and user_id', () => {
    const json = fixture('pixabay');
    delete json.hits[0].user_id;
    json.hits[1].user = '';
    const [first, second] = pixabay.normalize(json, { page: 1 }).results;
    assert.deepEqual(first.credit, { name: 'Josch13', site: 'Pixabay', siteUrl: 'https://pixabay.com/en/blossom-bloom-flower-195893/' });
    assert.equal('url' in second.credit, false);
    assert.equal('name' in second.credit, false);
  });

  it('normalize: hasMore stops at totalHits', () => {
    assert.equal(pixabay.normalize(fixture('pixabay'), { page: 25 }).hasMore, false);
  });
});

describe('unsplash adapter', () => {
  it('request: the exact URL and Client-ID header', () => {
    const { url, headers } = unsplash.request('coffee', { page: 1, key: 'US-KEY' });
    assert.equal(url, 'https://api.unsplash.com/search/photos?query=coffee&page=1&per_page=20');
    assert.deepEqual(headers, { Authorization: 'Client-ID US-KEY' });
  });

  it('normalize: link mode, sized URL, UTM credit links, download location', () => {
    const { results, hasMore } = unsplash.normalize(fixture('unsplash'), { page: 1 });
    assert.equal(hasMore, true);
    assert.deepEqual(results[0], {
      source: 'unsplash',
      id: 'eOLpJytrbsQ',
      mode: 'link',
      thumb: 'https://images.unsplash.com/photo-1416339306562-f3d12fefd36f?ixid=abc&w=400',
      url: 'https://images.unsplash.com/photo-1416339306562-f3d12fefd36f?ixid=abc&w=2400&fit=max&q=80&auto=format',
      width: 2400,
      height: 1800,
      description: 'man holding a coffee cup',
      downloadLocation: 'https://api.unsplash.com/photos/eOLpJytrbsQ/download?ixid=abc',
      credit: {
        name: 'Jeff Sheldon',
        url: `http://unsplash.com/@ugmonk?${UTM}`,
        site: 'Unsplash',
        siteUrl: `http://unsplash.com/photos/eOLpJytrbsQ?${UTM}`,
      },
    });
    assert.equal(results[1].description, 'Tall coffee shot');
    assert.equal(results[1].width, 1200);
    assert.equal(results[1].height, 1800);
  });

  it('normalize: UTM joins with & when the link already has a query', () => {
    const json = fixture('unsplash');
    json.results[0].user.links.html = 'https://unsplash.com/@ugmonk?ref=x';
    const [first] = unsplash.normalize(json, { page: 1 }).results;
    assert.equal(first.credit.url, `https://unsplash.com/@ugmonk?ref=x&${UTM}`);
  });

  it('normalize: the size suffix joins with ? when raw has no query', () => {
    const json = fixture('unsplash');
    json.results[0].urls.raw = 'https://images.unsplash.com/photo-1';
    const [first] = unsplash.normalize(json, { page: 1 }).results;
    assert.equal(first.url, 'https://images.unsplash.com/photo-1?w=2400&fit=max&q=80&auto=format');
  });

  it('normalize: drops a result with no usable raw URL, and a missing link gets no UTM', () => {
    const json = fixture('unsplash');
    delete json.results[0].urls.raw;
    delete json.results[1].user.links;
    const { results } = unsplash.normalize(json, { page: 1 });
    assert.deepEqual(results.map((r) => r.id), ['small1']);
    assert.equal('url' in results[0].credit, false);
  });

  it('normalize: the last page has no more', () => {
    assert.equal(unsplash.normalize(fixture('unsplash'), { page: 7 }).hasMore, false);
  });
});
