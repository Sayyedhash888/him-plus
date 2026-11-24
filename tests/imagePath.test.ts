import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractImagePath, isImageFilePath, isImagePathText } from '../src/lib/imagePath.ts';

test('recognises Windows image paths, quoted or not', () => {
  assert.equal(
    extractImagePath('C:\\Users\\USER\\Pictures\\Screenshot (3).png'),
    'C:\\Users\\USER\\Pictures\\Screenshot (3).png',
  );
  assert.equal(
    extractImagePath('"D:\\Projects\\shot.webp"'),
    'D:\\Projects\\shot.webp',
  );
  assert.equal(
    extractImagePath('\\\\server\\share\\photo.jpeg'),
    '\\\\server\\share\\photo.jpeg',
  );
  assert.equal(extractImagePath('/home/user/pic.png'), '/home/user/pic.png');
});

test('rejects non-image paths, text and multi-line content', () => {
  assert.equal(extractImagePath('C:\\Users\\USER\\notes.txt'), null);
  assert.equal(extractImagePath('hello world'), null);
  assert.equal(extractImagePath('https://example.com/a.png'), null);
  assert.equal(extractImagePath('C:\\a.png\nC:\\b.png'), null);
  assert.equal(extractImagePath('  '), null);
  assert.equal(isImagePathText('C:\\x\\y.PNG'), true);
  assert.equal(isImagePathText('C:\\x\\y.exe'), false);
});

test('detects image files for the in-app image viewer', () => {
  assert.equal(isImageFilePath('Screenshot (3).png'), true);
  assert.equal(isImageFilePath('D:\\Zed\\Screenshot (3).PNG'), true);
  assert.equal(isImageFilePath('assets/logo.webp'), true);
  assert.equal(isImageFilePath('src/Main.py'), false);
  assert.equal(isImageFilePath('notes.txt'), false);
  assert.equal(isImageFilePath('archive.png.zip'), false);
});

