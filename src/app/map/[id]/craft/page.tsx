import type { Metadata } from "next";
import CraftList from "@/components/CraftList";

export const metadata: Metadata = {
  title: "Craft · Third Degree",
  description: "Concrete upgrades to what you built, each one a diff against your code.",
};

export default async function CraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CraftList jobId={id} />;
}
