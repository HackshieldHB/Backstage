'use client';

import React from 'react';

/** Renders persisted TipTap JSON without mounting an editor instance. */

interface TipTapNode {
  type?: string;
  text?: string;
  content?: TipTapNode[];
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

function renderText(node: TipTapNode, key: number): React.ReactNode {
  let el: React.ReactNode = node.text ?? '';
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        el = <strong key={key}>{el}</strong>;
        break;
      case 'italic':
        el = <em key={key}>{el}</em>;
        break;
      case 'strike':
        el = <s key={key}>{el}</s>;
        break;
      case 'code':
        el = <code key={key}>{el}</code>;
        break;
      case 'link':
        el = (
          <a key={key} href={String(mark.attrs?.href ?? '#')} target="_blank" rel="noreferrer noopener">
            {el}
          </a>
        );
        break;
    }
  }
  return <React.Fragment key={key}>{el}</React.Fragment>;
}

function renderNode(node: TipTapNode, key: number): React.ReactNode {
  const children = (node.content ?? []).map((c, i) => renderNode(c, i));
  switch (node.type) {
    case 'text':
      return renderText(node, key);
    case 'paragraph':
      return <p key={key}>{children.length > 0 ? children : ' '}</p>;
    case 'mention':
      return (
        <span key={key} className="mention">
          @{String(node.attrs?.label ?? node.attrs?.id ?? 'someone')}
        </span>
      );
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{(node.content ?? []).map((c) => c.text).join('')}</code>
        </pre>
      );
    case 'blockquote':
      return <blockquote key={key}>{children}</blockquote>;
    case 'bulletList':
      return <ul key={key}>{children}</ul>;
    case 'orderedList':
      return <ol key={key}>{children}</ol>;
    case 'listItem':
      return <li key={key}>{children}</li>;
    case 'hardBreak':
      return <br key={key} />;
    case 'doc':
      return <React.Fragment key={key}>{children}</React.Fragment>;
    default:
      return <React.Fragment key={key}>{children}</React.Fragment>;
  }
}

export function MessageBody({ contentJson, contentText }: { contentJson: unknown; contentText: string }) {
  if (contentJson && typeof contentJson === 'object' && (contentJson as TipTapNode).type === 'doc') {
    return <div className="message-body text-[14px] leading-relaxed">{renderNode(contentJson as TipTapNode, 0)}</div>;
  }
  return <div className="message-body whitespace-pre-wrap text-[14px] leading-relaxed">{contentText}</div>;
}
