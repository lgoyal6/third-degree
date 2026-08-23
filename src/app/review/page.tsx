import type { Metadata } from "next";
import ReviewQueue from "@/components/ReviewQueue";

export const metadata: Metadata = {
  title: "Review · Third Degree",
  description: "The concepts you missed, and when they come back.",
};

export default function ReviewPage() {
  return <ReviewQueue />;
}
