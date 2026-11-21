"use client";

import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { MarkdownPre } from "@/components/markdown-code";

const DEFAULT_NPC_ENTITIES = [
  "Comandante Mireia",
  "Mireia",
  "Aguas Quietas",
  "Guardia de Hierro",
  "Necrófago de río",
  "Explorador de la Espesura",
  "Oakhaven",
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildEntityRegex(names: readonly string[]): RegExp | null {
  const unique = Array.from(
    new Set(
      names
        .map((n) => n.trim())
        .filter((n) => n.length >= 3),
    ),
  ).sort((a, b) => b.length - a.length);

  if (unique.length === 0) return null;
  const pattern = unique.map(escapeRegex).join("|");
  return new RegExp(`(?<![\\p{L}\\p{N}_])(${pattern})(?![\\p{L}\\p{N}_])`, "gu");
}

function highlightEntitiesInString(
  text: string,
  pcRegex: RegExp | null,
  npcRegex: RegExp | null,
  keyPrefix: string,
): React.ReactNode {
  if (!pcRegex && !npcRegex) return text;

  const applyRegex = (
    nodes: React.ReactNode[],
    regex: RegExp | null,
    className: string,
    tag: string,
  ): React.ReactNode[] => {
    if (!regex) return nodes;
    const out: React.ReactNode[] = [];
    nodes.forEach((node, idx) => {
      if (typeof node !== "string") {
        out.push(node);
        return;
      }
      regex.lastIndex = 0;
      let lastIdx = 0;
      let match: RegExpExecArray | null;
      let mIdx = 0;
      while ((match = regex.exec(node)) !== null) {
        if (match.index > lastIdx) {
          out.push(node.slice(lastIdx, match.index));
        }
        out.push(
          <span
            key={`${keyPrefix}-${tag}-${idx}-${mIdx++}`}
            className={className}
          >
            {match[0]}
          </span>,
        );
        lastIdx = match.index + match[0].length;
      }
      if (lastIdx < node.length) {
        out.push(node.slice(lastIdx));
      }
    });
    return out;
  };

  let segments: React.ReactNode[] = [text];
  segments = applyRegex(
    segments,
    pcRegex,
    "font-medium text-amber-700 dark:text-amber-400",
    "pc",
  );
  segments = applyRegex(
    segments,
    npcRegex,
    "font-medium text-violet-700 dark:text-violet-300",
    "npc",
  );
  return segments;
}

const DIALOGUE_REGEX = /("[^"\n]{2,360}"|«[^»\n]{2,360}»)/g;

function highlightStringWithDialogue(
  text: string,
  pcRegex: RegExp | null,
  npcRegex: RegExp | null,
  keyPrefix: string,
): React.ReactNode {
  DIALOGUE_REGEX.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let qIdx = 0;

  while ((match = DIALOGUE_REGEX.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(
        highlightEntitiesInString(
          text.slice(lastIdx, match.index),
          pcRegex,
          npcRegex,
          `${keyPrefix}-p-${qIdx}`,
        ),
      );
    }
    parts.push(
      <em
        key={`${keyPrefix}-q-${qIdx}`}
        className="italic text-foreground/90"
      >
        {highlightEntitiesInString(
          match[0],
          pcRegex,
          npcRegex,
          `${keyPrefix}-qi-${qIdx}`,
        )}
      </em>,
    );
    qIdx += 1;
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx === 0) {
    return highlightEntitiesInString(text, pcRegex, npcRegex, keyPrefix);
  }
  if (lastIdx < text.length) {
    parts.push(
      highlightEntitiesInString(
        text.slice(lastIdx),
        pcRegex,
        npcRegex,
        `${keyPrefix}-tail`,
      ),
    );
  }
  return parts;
}

function transformChildren(
  children: React.ReactNode,
  pcRegex: RegExp | null,
  npcRegex: RegExp | null,
  prefix = "n",
): React.ReactNode {
  return React.Children.map(children, (child, idx) => {
    if (typeof child === "string") {
      return highlightStringWithDialogue(
        child,
        pcRegex,
        npcRegex,
        `${prefix}-${idx}`,
      );
    }
    if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
      if (child.type === "code" || child.type === "pre" || child.type === "a") {
        return child;
      }
      if (child.props.children) {
        return React.cloneElement(child, {
          children: transformChildren(
            child.props.children,
            pcRegex,
            npcRegex,
            `${prefix}-${idx}`,
          ),
        });
      }
    }
    return child;
  });
}

export function NarrativeText({
  text,
  pcNames = [],
  npcNames = [],
}: {
  text: string;
  pcNames?: readonly string[];
  npcNames?: readonly string[];
}) {
  const { pcRegex, npcRegex } = React.useMemo(() => {
    const expandedPcNames: string[] = [];
    for (const full of pcNames) {
      expandedPcNames.push(full);
      const first = full.split(/\s+/)[0];
      if (first && first.length >= 3) {
        expandedPcNames.push(first);
      }
    }
    const pcSet = new Set(expandedPcNames.map((n) => n.toLowerCase()));
    const mergedNpcs = [...DEFAULT_NPC_ENTITIES, ...npcNames].filter(
      (n) => !pcSet.has(n.toLowerCase()),
    );
    return {
      pcRegex: buildEntityRegex(expandedPcNames),
      npcRegex: buildEntityRegex(mergedNpcs),
    };
  }, [pcNames, npcNames]);

  const components = React.useMemo<Components>(
    () => ({
      pre: MarkdownPre,
      p: ({ children }) => (
        <p>{transformChildren(children, pcRegex, npcRegex, "p")}</p>
      ),
      li: ({ children }) => (
        <li>{transformChildren(children, pcRegex, npcRegex, "li")}</li>
      ),
      blockquote: ({ children }) => (
        <blockquote className="border-l-2 border-amber-500/40 pl-3.5 italic text-foreground/85">
          {transformChildren(children, pcRegex, npcRegex, "bq")}
        </blockquote>
      ),
    }),
    [pcRegex, npcRegex],
  );

  return (
    <div className="typeset typeset-docs text-foreground/92">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
