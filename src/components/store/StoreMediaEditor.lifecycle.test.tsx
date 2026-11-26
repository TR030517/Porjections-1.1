import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import StoreMediaEditor from './StoreMediaEditor';

type Element = React.ReactElement<Record<string, any>>;

function find(tree: unknown, match: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, match)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const element = tree as Element;
  return match(element) ? element : find(element.props.children, match);
}

test('preview reload preserves the draft and Escape cancels the gallery drag before closing the editor', async () => {
  const globals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  let targetedCard: { dataset: { storeGalleryCard: string } } | null = null;
  const keyListeners = new Map<EventListener, boolean>();
  const doc: Record<string, unknown> = {
    nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {},
    elementFromPoint: () => ({ closest: () => targetedCard }),
  };
  const win = {
    document: doc, HTMLIFrameElement: class {},
    addEventListener(type: string, listener: EventListener, capture = false) {
      if (type === 'keydown') keyListeners.set(listener, capture);
    },
    removeEventListener(type: string, listener: EventListener) {
      if (type === 'keydown') keyListeners.delete(listener);
    },
  };
  doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const root = createRoot(container as unknown as HTMLElement);
  const canonical = '/api/v1/upload/media/00000000-0000-4000-8000-000000000001/file';
  const transient = 'blob:synthetic-preview';
  const alternate = 'https://images.example.test/gallery.jpg';
  const changes: string[] = [];
  let editor: unknown, preview: unknown;

  function PreviewProbe({ element }: { element: Element }) {
    preview = (element.type as React.FunctionComponent<Element['props']>)(element.props);
    return null;
  }

  function EditorProbe({ previewUrls, kind = 'banner' }: { previewUrls?: ReadonlyMap<string, string>; kind?: 'banner' | 'gallery' }) {
    const value = kind === 'gallery' ? canonical + '\n' + alternate : canonical;
    editor = StoreMediaEditor({ kind, value, onChange: next => changes.push(next), previewUrls });
    if (kind === 'gallery') {
      const gallery = control(editor, node => node.type === 'ol');
      gallery.props.ref.current = { contains: (card: unknown) => card === targetedCard };
    }
    const child = find(editor, node => typeof node.type === 'function' && node.type.name === 'MediaPreview');
    assert.ok(child);
    return <PreviewProbe key={child.key} element={child} />;
  }

  const control = (tree: unknown, match: (node: Element) => boolean) => {
    const element = find(tree, match);
    assert.ok(element, 'expected control exists');
    return element;
  };
  const image = () => control(preview, element => element.type === 'img');
  const retry = () => control(preview, element => element.type === 'button' && element.props['aria-label'] === '重新加载横幅图片');
  try {
    await act(async () => root.render(<EditorProbe />));
    assert.equal(image().props.src, canonical);
    await act(async () => image().props.onError());
    assert.equal(find(preview, element => element.type === 'img'), undefined);
    await act(async () => retry().props.onClick());
    assert.equal(image().props.src, canonical);
    await act(async () => image().props.onError());
    await act(async () => root.render(<EditorProbe previewUrls={new Map([[canonical, transient]])} />));
    assert.equal(image().props.src, transient);
    assert.equal(control(editor, element => element.type === 'input' && element.props.type === 'text').props.value, canonical);
    assert.deepEqual(changes, []);

    await act(async () => root.render(<EditorProbe kind="gallery" />));
    const drag = () => control(editor, element => typeof element.props.onPointerDown === 'function');
    const escape = () => {
      let stopped = false;
      const event = { key: 'Escape', preventDefault() {}, stopPropagation() { stopped = true; } } as unknown as Event;
      for (const [listener, capture] of keyListeners) if (capture) listener(event);
      return stopped;
    };
    let capturedPointer = false;
    const pointer = {
      isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: 0, preventDefault() {},
      currentTarget: {
        setPointerCapture() { capturedPointer = true; },
        hasPointerCapture() { return capturedPointer; },
        releasePointerCapture() { capturedPointer = false; },
      },
    };
    assert.equal(escape(), false, 'let the workspace handle Escape while idle');
    await act(async () => drag().props.onPointerDown(pointer));
    targetedCard = { dataset: { storeGalleryCard: alternate } };
    await act(async () => drag().props.onPointerMove({ ...pointer, clientX: 50 }));
    assert.equal(capturedPointer, true);
    await act(async () => { assert.equal(escape(), true, 'handle Escape before the workspace closes'); });
    assert.equal(capturedPointer, false);
    await act(async () => drag().props.onPointerUp({ ...pointer, clientX: 50 }));
    assert.deepEqual(changes, [], 'a cancelled drag cannot reorder the gallery');
    assert.equal(escape(), false, 'restore workspace Escape after the drag is cancelled');
  } finally {
    await act(async () => root.unmount());
    globals.forEach((key, index) => {
      const descriptor = descriptors[index];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});
