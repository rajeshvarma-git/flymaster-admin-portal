import crypto, { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const OTP_EXPIRY_MINUTES = 10;
const OTP_RATE_LIMIT_MS = 60_000;
const OTP_MAX_ATTEMPTS = 5;

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`;
  return digits;
}

function phonesMatch(left, right) {
  const a = normalizePhone(left);
  const b = normalizePhone(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.slice(-10) === b.slice(-10);
}

function hashOtp(code) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(code), salt, 32).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyOtpHash(code, stored) {
  if (!stored?.startsWith("scrypt:")) return false;
  const [, salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const next = scryptSync(String(code), salt, 32);
  const prev = Buffer.from(hash, "hex");
  return next.length === prev.length && timingSafeEqual(next, prev);
}

function isConvertedLead(lead) {
  return lead?.entity_type === "student" || lead?.lead_status === "converted";
}

export function createWhatsAppService(deps) {
  const { jsonTable, jsonUpsert, config, notify } = deps;

  async function findLeadByPhone(phone) {
    const leads = await jsonTable("student_leads");
    return leads.find((row) => phonesMatch(row.phone, phone) || phonesMatch(row.whatsapp_number, phone)) || null;
  }

  async function findLeadForUser(userId) {
    const leads = await jsonTable("student_leads");
    return (
      leads.find(
        (row) =>
          String(row.user_id || "") === String(userId) ||
          String(row.id) === String(userId),
      ) || null
    );
  }

  function resolveStaffForLead(lead) {
    if (!lead) return null;
    if (isConvertedLead(lead)) {
      const staffId = String(lead.assigned_counselor_id || "");
      if (!staffId) return null;
      return { staffId, staffRole: "counselor" };
    }
    const staffId = String(lead.assigned_telecaller_id || "");
    if (!staffId) return null;
    return { staffId, staffRole: "telecaller" };
  }

  async function getOrCreateConversation(lead, phone) {
    const phoneNumber = normalizePhone(phone || lead.whatsapp_number || lead.phone);
    const staff = resolveStaffForLead(lead);
    const conversations = await jsonTable("whatsapp_conversations");
    const existing = conversations.find(
      (row) =>
        String(row.lead_id) === String(lead.id) ||
        phonesMatch(row.phone_number, phoneNumber),
    );
    if (existing) return existing;

    const now = new Date().toISOString();
    return jsonUpsert("whatsapp_conversations", {
      id: crypto.randomUUID(),
      lead_id: String(lead.id),
      user_id: lead.user_id ? String(lead.user_id) : "",
      phone_number: phoneNumber,
      assigned_staff_id: staff?.staffId || "",
      staff_role: staff?.staffRole || "",
      last_message_at: now,
      created_at: now,
    });
  }

  async function storeInboundMessage({ from, text, waMessageId }) {
    const lead = await findLeadByPhone(from);
    if (!lead) {
      console.log(`WhatsApp message from unknown number ${from}: ${text.slice(0, 80)}`);
      return null;
    }

    const conversation = await getOrCreateConversation(lead, from);
    const staff = resolveStaffForLead(lead);
    const now = new Date().toISOString();

    const created = await jsonUpsert("whatsapp_messages", {
      id: crypto.randomUUID(),
      conversation_id: conversation.id,
      direction: "inbound",
      body: text,
      wa_message_id: waMessageId || "",
      staff_id: "",
      is_read: false,
      created_at: now,
    });

    await jsonUpsert("whatsapp_conversations", { ...conversation, last_message_at: now });

    if (staff?.staffId && notify) {
      const name = `${lead.first_name || "Lead"} ${lead.last_name || ""}`.trim();
      const path = isConvertedLead(lead) ? `/admin/students/${lead.id}` : `/admin/leads/${lead.id}`;
      await notify(staff.staffId, "New WhatsApp message", `${name}: ${text.slice(0, 140)}`, "info", path);
    }

    return created;
  }

  async function storeOutboundMessage({ conversationId, body, staffId, waMessageId }) {
    const now = new Date().toISOString();
    const created = await jsonUpsert("whatsapp_messages", {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      direction: "outbound",
      body,
      wa_message_id: waMessageId || "",
      staff_id: staffId || "",
      is_read: true,
      created_at: now,
    });

    const conversations = await jsonTable("whatsapp_conversations");
    const conversation = conversations.find((row) => String(row.id) === String(conversationId));
    if (conversation) {
      await jsonUpsert("whatsapp_conversations", { ...conversation, last_message_at: now });
    }
    return created;
  }

  async function sendViaMeta({ to, text, templateName, templateParams }) {
    const token = config.accessToken;
    const phoneNumberId = config.phoneNumberId;
    if (!token || !phoneNumberId) {
      throw new Error("WhatsApp API is not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.");
    }

    const payload = templateName
      ? {
          messaging_product: "whatsapp",
          to: normalizePhone(to),
          type: "template",
          template: {
            name: templateName,
            language: { code: "en" },
            components: [
              {
                type: "body",
                parameters: (templateParams || []).map((value) => ({ type: "text", text: String(value) })),
              },
            ],
          },
        }
      : {
          messaging_product: "whatsapp",
          to: normalizePhone(to),
          type: "text",
          text: { body: text },
        };

    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.message || "WhatsApp send failed");
    }
    return data?.messages?.[0]?.id || "";
  }

  async function sendTextMessage(to, text) {
    return sendViaMeta({ to, text });
  }

  async function sendOtpMessage(to, code) {
    if (config.otpTemplateName) {
      return sendViaMeta({
        to,
        templateName: config.otpTemplateName,
        templateParams: [code],
      });
    }
    return sendViaMeta({
      to,
      text: `Your Fly Masters verification code is ${code}. Valid for ${OTP_EXPIRY_MINUTES} minutes.`,
    });
  }

  async function sendOtp({ userId, phone }) {
    const normalized = normalizePhone(phone);
    if (normalized.length < 12) {
      throw Object.assign(new Error("Enter a valid 10-digit mobile number."), { status: 400 });
    }

    const lead = await findLeadForUser(userId);
    if (!lead) {
      throw Object.assign(new Error("No lead record found for your account."), { status: 404 });
    }

    const verifications = await jsonTable("whatsapp_verifications");
    const recent = verifications
      .filter((row) => phonesMatch(row.phone_number, normalized) && !row.verified_at)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];

    if (recent?.created_at) {
      const elapsed = Date.now() - new Date(recent.created_at).getTime();
      if (elapsed < OTP_RATE_LIMIT_MS) {
        throw Object.assign(new Error("Please wait a minute before requesting another code."), { status: 429 });
      }
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000).toISOString();
    const now = new Date().toISOString();

    await jsonUpsert("whatsapp_verifications", {
      id: crypto.randomUUID(),
      phone_number: normalized,
      user_id: String(userId),
      code_hash: hashOtp(code),
      attempts: 0,
      expires_at: expiresAt,
      verified_at: null,
      created_at: now,
    });

    await sendOtpMessage(normalized, code);

    await jsonUpsert("student_leads", {
      ...lead,
      whatsapp_number: normalized,
    });

    return { ok: true, phone: normalized.slice(-10), expiresInMinutes: OTP_EXPIRY_MINUTES };
  }

  async function verifyOtp({ userId, phone, code }) {
    const normalized = normalizePhone(phone);
    const verifications = await jsonTable("whatsapp_verifications");
    const record = verifications
      .filter(
        (row) =>
          String(row.user_id) === String(userId) &&
          phonesMatch(row.phone_number, normalized) &&
          !row.verified_at,
      )
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];

    if (!record) {
      throw Object.assign(new Error("No active verification code. Request a new one."), { status: 400 });
    }

    if (new Date(record.expires_at).getTime() < Date.now()) {
      throw Object.assign(new Error("Code expired. Request a new one."), { status: 400 });
    }

    const attempts = Number(record.attempts || 0) + 1;
    if (attempts > OTP_MAX_ATTEMPTS) {
      throw Object.assign(new Error("Too many attempts. Request a new code."), { status: 429 });
    }

    if (!verifyOtpHash(code, record.code_hash)) {
      await jsonUpsert("whatsapp_verifications", { ...record, attempts });
      throw Object.assign(new Error("Incorrect code. Try again."), { status: 400 });
    }

    const now = new Date().toISOString();
    await jsonUpsert("whatsapp_verifications", { ...record, attempts, verified_at: now });

    const lead = await findLeadForUser(userId);
    if (lead) {
      await jsonUpsert("student_leads", {
        ...lead,
        whatsapp_number: normalized,
        whatsapp_verified: true,
        whatsapp_verified_at: now,
        phone: lead.phone || normalized.slice(-10),
      });
      await getOrCreateConversation({ ...lead, whatsapp_number: normalized }, normalized);
    }

    return { ok: true, verified: true };
  }

  async function getVerificationStatus(userId) {
    const lead = await findLeadForUser(userId);
    return {
      verified: Boolean(lead?.whatsapp_verified),
      phone: lead?.whatsapp_number ? String(lead.whatsapp_number).slice(-10) : "",
      verifiedAt: lead?.whatsapp_verified_at || null,
    };
  }

  function staffCanAccessConversation(conversation, user, counselors) {
    const role = user.role;
    if (role === "admin" || role === "super_admin") return true;
    if (role === "telecaller") {
      return String(conversation.assigned_staff_id) === String(user.id) && conversation.staff_role === "telecaller";
    }
    if (role === "counselor") {
      const counselor = counselors.find(
        (row) => String(row.auth_user_id || "") === String(user.id) || String(row.id) === String(user.id),
      );
      const counselorIds = new Set(
        [counselor?.id, counselor?.auth_user_id, user.id].filter(Boolean).map(String),
      );
      return counselorIds.has(String(conversation.assigned_staff_id)) && conversation.staff_role === "counselor";
    }
    return false;
  }

  async function filterConversationsForStaff(user, counselors) {
    const conversations = await jsonTable("whatsapp_conversations");
    return conversations.filter((row) => staffCanAccessConversation(row, user, counselors));
  }

  return {
    normalizePhone,
    phonesMatch,
    findLeadByPhone,
    findLeadForUser,
    resolveStaffForLead,
    getOrCreateConversation,
    storeInboundMessage,
    storeOutboundMessage,
    sendTextMessage,
    sendOtp,
    verifyOtp,
    getVerificationStatus,
    staffCanAccessConversation,
    filterConversationsForStaff,
  };
}
