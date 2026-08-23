import type { Metadata } from "next";
import ShelfView from "@/components/ShelfView";

export const metadata: Metadata = {
  title: "Your shelf · Third Degree",
  description: "The repos you've mapped, sorted by how interrogable they are.",
};

export default function ShelfPage() {
  return <ShelfView />;
}
