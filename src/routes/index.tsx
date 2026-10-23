import { createFileRoute } from "@tanstack/react-router";
import { Console } from "@/components/scalar/console";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <Console />;
}
