import { createFileRoute } from "@tanstack/react-router";
import { Studio } from "@/components/omnimod/studio";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Studio />;
}
