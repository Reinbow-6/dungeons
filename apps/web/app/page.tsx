import type { Metadata } from "next";

import { Chat } from "@/components/chat";
import { MODELS } from "@/lib/models";

export const metadata: Metadata = {
  title: "Aguas Quietas — Dungeons IA DM",
  description:
    "Plataforma de rol D&D 5e (SRD 5.2.1) guiada por IA Dungeon Master con motor determinista y modo híbrido.",
};

export default function Page() {
  return <Chat models={MODELS} />;
}
