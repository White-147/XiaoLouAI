import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createPromptReferenceToken,
  getPromptReferenceLabel,
  splitPromptReferenceTokens,
} from '../../utils/promptReferences';

export type PromptImageReference = {
  id: string;
  url: string;
  label: string;
};

type ReferencePromptInputProps = {
  value: string;
  references: PromptImageReference[];
  placeholder?: string;
  isDark: boolean;
  minHeight: number;
  maxHeight: number;
  expanded?: boolean;
  onChange: (value: string) => void;
  onBlur?: (value: string) => void;
  onWheel?: (event: React.WheelEvent<HTMLDivElement>) => void;
};

function createReferenceChip(
  reference: PromptImageReference | undefined,
  referenceId: string,
  isDark: boolean,
) {
  const chip = document.createElement('span');
  chip.contentEditable = 'false';
  chip.dataset.promptReferenceId = referenceId;
  chip.className = [
    'mx-0.5 inline-flex translate-y-[3px] items-center gap-1 rounded-full border px-1.5 py-0.5 align-baseline text-[11px] font-medium shadow-sm',
    isDark
      ? 'border-white/15 bg-white/10 text-white'
      : 'border-[#ded6c8] bg-[#f3efe7] text-[#514b43]',
  ].join(' ');

  if (reference?.url) {
    const image = document.createElement('img');
    image.src = reference.url;
    image.alt = reference.label;
    image.className = 'h-5 w-5 rounded-full object-cover';
    image.draggable = false;
    chip.appendChild(image);
  } else {
    const fallback = document.createElement('span');
    fallback.className = [
      'h-5 w-5 rounded-full',
      isDark ? 'bg-neutral-700' : 'bg-neutral-300',
    ].join(' ');
    chip.appendChild(fallback);
  }

  const label = document.createElement('span');
  label.textContent = `@${reference?.label || '参考图已移除'}`;
  chip.appendChild(label);
  return chip;
}

function appendTextWithBreaks(root: HTMLElement, value: string) {
  const parts = value.split('\n');
  parts.forEach((part, index) => {
    if (index > 0) root.appendChild(document.createElement('br'));
    if (part) root.appendChild(document.createTextNode(part));
  });
}

function renderPromptValue(
  root: HTMLElement,
  value: string,
  references: PromptImageReference[],
  isDark: boolean,
) {
  root.innerHTML = '';
  const chunks = splitPromptReferenceTokens(value);
  chunks.forEach((chunk) => {
    if (chunk.type === 'text') {
      appendTextWithBreaks(root, chunk.value);
      return;
    }
    const reference = references.find((item) => item.id === chunk.id);
    root.appendChild(createReferenceChip(reference, chunk.id, isDark));
  });
}

function serializePromptValue(root: HTMLElement) {
  const walk = (node: ChildNode): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const element = node as HTMLElement;
    const referenceId = element.dataset.promptReferenceId;
    if (referenceId) {
      return createPromptReferenceToken(referenceId);
    }

    if (element.tagName === 'BR') {
      return '\n';
    }

    const childText = Array.from(element.childNodes).map(walk).join('');
    if (element.tagName === 'DIV' || element.tagName === 'P') {
      return childText ? `${childText}\n` : '\n';
    }
    return childText;
  };

  return Array.from(root.childNodes)
    .map(walk)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n$/g, '');
}

function getRangeAtEditorEnd(editor: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  return range;
}

export const ReferencePromptInput: React.FC<ReferencePromptInputProps> = ({
  value,
  references,
  placeholder,
  isDark,
  minHeight,
  maxHeight,
  expanded,
  onChange,
  onBlur,
  onWheel,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const lastRenderedRef = useRef<string>('');
  const [isFocused, setIsFocused] = useState(false);
  const [isMentionOpen, setIsMentionOpen] = useState(false);
  const [isEmpty, setIsEmpty] = useState(!value);

  const referenceLookupKey = useMemo(
    () => references.map((item) => `${item.id}:${item.url}:${item.label}`).join('|'),
    [references],
  );

  const syncEmptyState = () => {
    const editor = editorRef.current;
    if (!editor) return;
    setIsEmpty(serializePromptValue(editor).trim().length === 0);
  };

  const saveSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
    }
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const shouldRender =
      lastRenderedRef.current !== value ||
      !isFocused ||
      editor.childNodes.length === 0;

    if (!shouldRender) return;

    renderPromptValue(editor, value, references, isDark);
    lastRenderedRef.current = value;
    syncEmptyState();
  }, [value, referenceLookupKey, isDark, isFocused]);

  const commitEditorValue = () => {
    const editor = editorRef.current;
    if (!editor) return '';
    const nextValue = serializePromptValue(editor);
    lastRenderedRef.current = nextValue;
    setIsEmpty(nextValue.trim().length === 0);
    onChange(nextValue);
    return nextValue;
  };

  const insertReference = (reference: PromptImageReference) => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;

    const range = savedRangeRef.current || getRangeAtEditorEnd(editor);
    selection.removeAllRanges();
    selection.addRange(range);

    range.deleteContents();
    const chip = createReferenceChip(reference, reference.id, isDark);
    const spacer = document.createTextNode(' ');
    range.insertNode(spacer);
    range.insertNode(chip);
    range.setStartAfter(spacer);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    setIsMentionOpen(false);
    commitEditorValue();
    saveSelection();
  };

  const openMentionPicker = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== '@') return;
    event.preventDefault();
    saveSelection();
    setIsMentionOpen(true);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  return (
    <div className="relative">
      {isEmpty && !isFocused ? (
        <div
          className={`pointer-events-none absolute left-0 top-0 text-sm font-light leading-relaxed ${
            isDark ? 'text-neutral-600' : 'text-neutral-400'
          }`}
          style={{ paddingTop: 0 }}
        >
          {placeholder}
        </div>
      ) : null}
      <div
        ref={editorRef}
        role="textbox"
        aria-label="提示词"
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        className={`w-full bg-transparent text-sm outline-none font-light leading-relaxed whitespace-pre-wrap break-words ${
          isDark ? 'text-white' : 'text-neutral-900'
        } ${expanded ? 'pr-1' : ''}`}
        style={{
          minHeight: `${minHeight}px`,
          maxHeight: `${maxHeight}px`,
          overflowY: 'auto',
        }}
        onFocus={() => {
          setIsFocused(true);
          saveSelection();
        }}
        onBlur={() => {
          setIsFocused(false);
          setIsMentionOpen(false);
          const nextValue = commitEditorValue();
          onBlur?.(nextValue);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setIsMentionOpen(false);
            return;
          }
          openMentionPicker(event);
        }}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onInput={() => {
          commitEditorValue();
          saveSelection();
        }}
        onPaste={handlePaste}
        onWheel={onWheel}
      />

      {isMentionOpen ? (
        <div
          className={`absolute left-0 top-full z-[170] mt-2 w-[256px] overflow-hidden rounded-2xl border shadow-2xl ${
            isDark ? 'border-neutral-700 bg-[#20201f]' : 'border-[#e6ded0] bg-white'
          }`}
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className={`px-3 py-2 text-[11px] ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>
            选择要插入到提示词中的参考图
          </div>
          {references.length ? (
            <div className="max-h-56 overflow-y-auto py-1">
              {references.map((reference) => (
                <button
                  key={reference.id}
                  type="button"
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-xs transition-colors ${
                    isDark
                      ? 'text-neutral-100 hover:bg-neutral-800'
                      : 'text-[#403a32] hover:bg-[#f6f1e8]'
                  }`}
                  onClick={() => insertReference(reference)}
                >
                  <img
                    src={reference.url}
                    alt={reference.label}
                    className="h-9 w-9 rounded-xl object-cover"
                    draggable={false}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">@{reference.label}</span>
                    <span className={`block truncate ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                      {getPromptReferenceLabel(reference.id, references)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className={`px-3 pb-3 text-xs ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
              当前节点还没有传入参考图，先点击上方 + 添加图片。
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};
