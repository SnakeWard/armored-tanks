import { createFileRoute } from "@tanstack/react-router";
import { ArmoredApp } from "@/components/armored/ArmoredApp";

export const Route = createFileRoute("/")({ component: ArmoredApp });
