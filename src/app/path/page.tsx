import type { Metadata } from "next";
import PathView from "@/components/PathView";

export const metadata: Metadata = {
  title: "Your path · Third Degree",
  description: "The concepts your own answers turned up, in the order worth studying them.",
};

export default function PathPage() {
  return <PathView />;
}
