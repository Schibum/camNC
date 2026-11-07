import { AboutPage } from '@/about/AboutPage';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/about')({ component: AboutPage });
