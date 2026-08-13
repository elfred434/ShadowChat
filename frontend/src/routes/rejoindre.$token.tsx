import { createFileRoute } from '@tanstack/react-router'
import { JoinInvitePage } from '@/components/JoinInvitePage'

export const Route = createFileRoute('/rejoindre/$token')({ component: JoinInvitePage })
