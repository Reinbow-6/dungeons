"use client";

import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { MarkdownPre } from "@/components/markdown-code";
import { useSmoothText } from "@/hooks/use-smooth-text";
import type { StreamSpeed } from "@/lib/settings/app-settings";

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

function normalizeGuillemets(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return `«${trimmed.slice(1, -1)}»`;
  }
  return text.replace(/"([^"\n]{2,360})"/g, "«$1»");
}

function extractPlainText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractPlainText).join("");
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractPlainText(node.props.children);
  }
  return "";
}

function parseDialogueBlockquote(children: React.ReactNode): {
  speaker: string | null;
  bodyText: string;
} | null {
  const raw = extractPlainText(children).trim();
  if (!raw) return null;

  const lines = raw
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  // Case 1: Speaker header line followed by dialogue line(s)
  if (lines.length >= 2) {
    const first = lines[0]!;
    const rest = lines.slice(1).join("\n");
    const looksLikeSpeaker =
      first.length <= 64 &&
      !first.startsWith("«") &&
      !first.startsWith('"') &&
      (rest.includes("«") || rest.includes('"'));
    if (looksLikeSpeaker) {
      return {
        speaker: first.replace(/[:：]+$/, "").trim(),
        bodyText: normalizeGuillemets(rest),
      };
    }
  }

  // Case 2: React-markdown placed <strong>Speaker</strong> and «...» in a single <p>
  const flatChildren = React.Children.toArray(children).filter(
    (c) => !(typeof c === "string" && c.trim() === ""),
  );
  if (flatChildren.length === 1 && React.isValidElement<{ children?: React.ReactNode }>(flatChildren[0])) {
    const pKids = React.Children.toArray(flatChildren[0].props.children);
    const firstKid = pKids[0];
    if (
      React.isValidElement<{ children?: React.ReactNode }>(firstKid) &&
      firstKid.type === "strong"
    ) {
      const speaker = extractPlainText(firstKid.props.children)
        .replace(/[:：]+$/, "")
        .trim();
      const restText = pKids
        .slice(1)
        .map(extractPlainText)
        .join("")
        .replace(/^\s*[:：]?\s*/, "")
        .trim();
      if (speaker && speaker.length <= 64 && restText) {
        return {
          speaker,
          bodyText: normalizeGuillemets(restText),
        };
      }
    }
  }

  return {
    speaker: null,
    bodyText: normalizeGuillemets(raw),
  };
}

export function NarrativeText({
  text,
  isStreaming = false,
  streamSpeed = "normal",
  pcNames = [],
  npcNames = [],
}: {
  text: string;
  isStreaming?: boolean;
  streamSpeed?: StreamSpeed;
  pcNames?: readonly string[];
  npcNames?: readonly string[];
}) {
  const displayedText = useSmoothText(text, isStreaming, streamSpeed);

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
        <p className="max-w-[68ch] text-foreground">
          {transformChildren(children, pcRegex, npcRegex, "p")}
        </p>
      ),
      li: ({ children }) => (
        <li>{transformChildren(children, pcRegex, npcRegex, "li")}</li>
      ),
      blockquote: ({ children }) => {
        const parsed = parseDialogueBlockquote(children);
        if (!parsed) {
          return (
            <blockquote className="my-3.5 border-l-2 border-primary/80 pl-4 py-0.5 font-serif text-[16.5px] leading-[1.65] text-foreground/95">
              {transformChildren(children, pcRegex, npcRegex, "bq")}
            </blockquote>
          );
        }
        return (
          <blockquote className="my-3.5 border-l-2 border-primary/80 pl-4 py-0.5 not-italic">
            {parsed.speaker && (
              <div className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                {parsed.speaker}
              </div>
            )}
            <div className="whitespace-pre-line font-serif text-[16.5px] leading-[1.65] text-foreground/95">
              {highlightEntitiesInString(
                parsed.bodyText,
                pcRegex,
                npcRegex,
                "bq-body",
              )}
            </div>
          </blockquote>
        );
      },
    }),
    [pcRegex, npcRegex],
  );

  const sanitizedDisplayedText = React.useMemo(
    () =>
      displayedText
        .replace(/<resumen_motor>[\s\S]*?<\/resumen_motor>\s*/gi, "")
        .replace(/^\s*\[\[?[a-z_]+\s*→[^\]]*\]\]?\s*/i, ""),
    [displayedText],
  );

  return (
    <div className="typeset typeset-docs text-foreground/92">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {sanitizedDisplayedText}
      </ReactMarkdown>
    </div>
  );
}
