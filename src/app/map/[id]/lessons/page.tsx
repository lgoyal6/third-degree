import LessonDeck from "@/components/LessonDeck";

export default async function LessonsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LessonDeck jobId={id} />;
}
