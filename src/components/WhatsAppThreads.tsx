import { useEffect, useMemo, useState } from "react";
import { displayName } from "@/lib/utils";
import ChatInboxPanel, { type InboxMessage, type InboxThread } from "@/components/ChatInboxPanel";
import type { Lead, WhatsAppConversationRow, WhatsAppMessageRow } from "@/lib/types";

interface WhatsAppThreadsProps {
  conversations: WhatsAppConversationRow[];
  messages: WhatsAppMessageRow[];
  leads: Lead[];
  profileUrl: (lead: Lead | null, conversation: WhatsAppConversationRow) => string;
  emptyMessage: string;
  selectedId?: string | null;
  onSelectId?: (id: string) => void;
}

export default function WhatsAppThreads({
  conversations,
  messages,
  leads,
  profileUrl,
  emptyMessage,
  selectedId: controlledId,
  onSelectId,
}: WhatsAppThreadsProps) {
  const [internalId, setInternalId] = useState<string | null>(null);
  const selectedId = controlledId !== undefined ? controlledId : internalId;
  const setSelectedId = onSelectId || setInternalId;

  const threads = useMemo(() => {
    return conversations
      .map((conv) => {
        const lead = leads.find((row) => String(row.id) === String(conv.lead_id)) || null;
        const msgs = messages
          .filter((msg) => msg.conversation_id === conv.id)
          .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
        const last = msgs[msgs.length - 1];
        return {
          conv,
          lead,
          msgs,
          thread: {
            id: conv.id,
            title: lead ? displayName(lead.first_name, lead.last_name, lead.email) : `+${conv.phone_number?.slice(-10) || "—"}`,
            subtitle: `+${conv.phone_number?.slice(-10) || "—"}`,
            preview: last?.body || "No messages yet",
            lastAt: conv.last_message_at,
            unread: msgs.some((msg) => msg.direction === "inbound" && !msg.is_read),
          } satisfies InboxThread,
        };
      })
      .sort((a, b) => String(b.conv.last_message_at || "").localeCompare(String(a.conv.last_message_at || "")));
  }, [conversations, leads, messages]);

  useEffect(() => {
    if (!selectedId && threads[0]) setSelectedId(threads[0].thread.id);
  }, [selectedId, setSelectedId, threads]);

  const active = threads.find((row) => row.conv.id === selectedId) || threads[0] || null;

  const getMessages = (threadId: string): InboxMessage[] => {
    const row = threads.find((item) => item.conv.id === threadId);
    if (!row) return [];
    return row.msgs.map((msg) => ({
      id: msg.id,
      text: msg.body,
      outbound: msg.direction === "outbound",
      createdAt: msg.created_at,
      system: msg.kind === "system" || msg.staff_id === "system",
    }));
  };

  return (
    <ChatInboxPanel
      threads={threads.map((row) => row.thread)}
      getMessages={getMessages}
      selectedId={selectedId}
      onSelect={setSelectedId}
      emptyListMessage={emptyMessage}
      footerNote="Admin view is read-only. Assigned telecallers and counselors reply from their portal."
      headerNote="Click a name on the left to open that WhatsApp thread."
      profileHref={active ? profileUrl(active.lead, active.conv) : undefined}
      variant="emerald"
    />
  );
}
