(() => {
  const notificationStorageKey = "egabay-portal-notifications";
  const notificationToggle = document.querySelector("#notification-toggle");
  const notificationPanel = document.querySelector("#notification-panel");
  const notificationCount = document.querySelector("#notification-count");
  const notificationItems = document.querySelector("#notification-items");
  const notificationFeedback = document.querySelector("#notification-feedback");

  const switchAccountModal = document.querySelector("#switch-account-modal");
  const switchAccountCancel = document.querySelector("#switch-account-cancel");
  const switchAccountConfirm = document.querySelector("#switch-account-confirm");
  let switchAccountDestination = "";
  let switchAccountTrigger = null;

  function closeSwitchAccountDialog() {
    if (!switchAccountModal || switchAccountModal.hidden) return;
    switchAccountModal.hidden = true;
    switchAccountDestination = "";
    switchAccountTrigger?.focus();
    switchAccountTrigger = null;
  }

  document.querySelectorAll('.portal-nav-links a[href="login.html"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      if (!switchAccountModal || !switchAccountCancel || !switchAccountConfirm) return;
      event.preventDefault();
      switchAccountDestination = link.href;
      switchAccountTrigger = link;
      switchAccountModal.hidden = false;
      switchAccountCancel.focus();
    });
  });

  switchAccountCancel?.addEventListener("click", closeSwitchAccountDialog);
  switchAccountConfirm?.addEventListener("click", () => {
    if (switchAccountDestination) window.location.assign(switchAccountDestination);
  });
  switchAccountModal?.addEventListener("click", (event) => {
    if (event.target === switchAccountModal) closeSwitchAccountDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (!switchAccountModal || switchAccountModal.hidden) return;
    if (event.key === "Escape") {
      closeSwitchAccountDialog();
      return;
    }
    if (event.key === "Tab") {
      const focusable = [switchAccountCancel, switchAccountConfirm].filter(Boolean);
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
        event.preventDefault();
        focusable[0].focus();
      }
    }
  });

  function loadNotifications() {
    try {
      const saved = window.localStorage.getItem(notificationStorageKey);
      if (saved === null) return { items: [], error: "" };
      const items = JSON.parse(saved);
      if (!Array.isArray(items) || items.some((item) =>
        !item || typeof item.id !== "string" ||
        typeof item.title !== "string" ||
        typeof item.createdAt !== "string" ||
        typeof item.read !== "boolean"
      )) {
        return { items: [], error: "Saved notifications are invalid. Clear this browser’s site data to reset them." };
      }
      return { items, error: "" };
    } catch (error) {
      return { items: [], error: `Notifications could not be loaded from browser storage: ${error.message}` };
    }
  }

  function renderNotifications() {
    if (!notificationItems || !notificationCount || !notificationToggle) return;
    const result = loadNotifications();
    notificationFeedback.textContent = result.error;
    notificationItems.replaceChildren();
    result.items.forEach((item) => {
      const entry = document.createElement("article");
      entry.className = `notification-item${item.read ? "" : " is-unread"}`;
      const title = document.createElement("p");
      title.textContent = item.title;
      const date = document.createElement("time");
      date.dateTime = item.createdAt;
      date.textContent = new Date(item.createdAt).toLocaleString();
      entry.append(title, date);
      notificationItems.append(entry);
    });
    if (result.items.length === 0 && !result.error) {
      const empty = document.createElement("p");
      empty.className = "notification-empty";
      empty.textContent = "You’re all caught up.";
      notificationItems.append(empty);
    }
    const unreadCount = result.items.filter((item) => !item.read).length;
    notificationCount.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    notificationCount.hidden = unreadCount === 0;
    notificationToggle.setAttribute("aria-label", unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications");
  }

  function addNotification(title) {
    const result = loadNotifications();
    if (result.error) return result.error;
    result.items.unshift({
      id: `notification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      createdAt: new Date().toISOString(),
      read: false
    });
    try {
      window.localStorage.setItem(notificationStorageKey, JSON.stringify(result.items.slice(0, 50)));
      renderNotifications();
      return "";
    } catch (error) {
      const message = `Notification could not be saved in browser storage: ${error.message}`;
      if (notificationFeedback) notificationFeedback.textContent = message;
      return message;
    }
  }

  function markNotificationsRead() {
    const result = loadNotifications();
    if (result.error) {
      if (notificationFeedback) notificationFeedback.textContent = result.error;
      return;
    }
    const unreadItems = result.items.filter((item) => !item.read);
    if (unreadItems.length === 0) return;
    try {
      window.localStorage.setItem(notificationStorageKey, JSON.stringify(result.items.map((item) => ({ ...item, read: true }))));
      renderNotifications();
    } catch (error) {
      if (notificationFeedback) notificationFeedback.textContent = `Notifications could not be marked as read: ${error.message}`;
    }
  }

  notificationToggle?.addEventListener("click", () => {
    const opening = notificationPanel.hidden;
    notificationPanel.hidden = !opening;
    notificationToggle.setAttribute("aria-expanded", String(opening));
    if (opening) markNotificationsRead();
  });
  document.querySelector("#notification-close")?.addEventListener("click", () => {
    notificationPanel.hidden = true;
    notificationToggle.setAttribute("aria-expanded", "false");
    notificationToggle.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && notificationPanel && !notificationPanel.hidden) {
      notificationPanel.hidden = true;
      notificationToggle.setAttribute("aria-expanded", "false");
      notificationToggle.focus();
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key === notificationStorageKey) renderNotifications();
  });
  renderNotifications();

  let caregiverPatientNameForSession = "";
  try {
    const isCaregiverSession = window.sessionStorage.getItem("egabay-account-role") === "caregiver";
    const patientName = isCaregiverSession
      ? window.sessionStorage.getItem("egabay-caregiver-patient-name")
      : null;
    if (patientName) caregiverPatientNameForSession = patientName;
  } catch (error) {
    const applicationFeedback = document.querySelector("#id-form-feedback");
    if (applicationFeedback) {
      applicationFeedback.textContent = `Caregiver details could not be loaded for this session: ${error.message}`;
    }
  }
  const pwdAccountName = document.querySelector("#pwd-account-name");
  if (pwdAccountName) {
    try {
      pwdAccountName.textContent = window.sessionStorage.getItem("egabay-account-name") || "PWD User";
    } catch (error) {
      pwdAccountName.textContent = `Profile could not be loaded for this session: ${error.message}`;
    }
  }
  if (caregiverPatientNameForSession) {
    const assistanceApplicantName = document.querySelector("#request-name");
    const idApplicantName = document.querySelector("#id-applicant-name");
    if (assistanceApplicantName && !assistanceApplicantName.value) {
      assistanceApplicantName.value = caregiverPatientNameForSession;
    }
    if (idApplicantName && !idApplicantName.value) {
      idApplicantName.value = caregiverPatientNameForSession;
    }
  }

  const formBackLink = document.querySelector("#form-back-link");
  const formPortalLink = document.querySelector("#form-portal-link");
  if (formBackLink || formPortalLink) {
    try {
      const caregiverSignedIn = window.sessionStorage.getItem("egabay-account-role") === "caregiver";
      const portalPath = caregiverSignedIn ? "caregiver.html" : "pwd.html";
      if (formBackLink) {
        formBackLink.href = portalPath;
        formBackLink.textContent = caregiverSignedIn ? "← Back to caregiver portal" : "← Back to PWD portal";
      }
      if (formPortalLink) {
        formPortalLink.href = portalPath;
        formPortalLink.setAttribute("aria-label", caregiverSignedIn ? "Caregiver portal" : "PWD portal");
      }
    } catch (error) {
      const feedback = document.querySelector("#id-form-feedback");
      if (feedback) {
        feedback.textContent = `Portal navigation could not be loaded for this session: ${error.message}`;
      }
    }
  }

  const roleSelect = document.querySelector("#role-select");
  const adminDashboard = document.querySelector("#admin-dashboard");
  const caregiverContext = document.querySelector("#caregiver-context");
  const mainContent = document.querySelector("#main-content");
  const assistanceSection = document.querySelector("#assistance");
  const announcements = [
    { id: "PID-1001", type: "PWD ID renewal inquiry", municipality: "Boac", status: "Under review", explanation: "" },
    { id: "EG-2048", type: "Medicine support", municipality: "Boac", status: "Under review", explanation: "Assistance eligibility and approval are determined through the applicable program review." },
    { id: "EG-2051", type: "Food assistance", municipality: "Mogpog", status: "Received", explanation: "Your request has been received and is in the program's review queue." },
    { id: "EG-2039", type: "Transportation", municipality: "Gasan", status: "Update available", explanation: "An update is available for this request." }
  ];
  const trackerStorageKey = "egabay-tracker-records";
  let trackerStorageError = "";
  let savedTrackerRecords = [];
  try {
    const saved = window.localStorage.getItem(trackerStorageKey);
    if (saved !== null) {
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed) || parsed.some((record) =>
        !record || typeof record.id !== "string" ||
        typeof record.type !== "string" ||
        typeof record.municipality !== "string" ||
        typeof record.status !== "string" ||
        typeof record.explanation !== "string"
      )) {
        throw new Error("Saved tracker records are invalid. Clear this browser’s site data to reset them.");
      }
      savedTrackerRecords = parsed;
      announcements.push(...savedTrackerRecords);
    }
  } catch (error) {
    trackerStorageError = `Saved reference records could not be loaded: ${error.message}`;
  }

  function saveTrackerRecord(request) {
    announcements.push(request);
    if (trackerStorageError) return trackerStorageError;
    savedTrackerRecords.push(request);
    try {
      window.localStorage.setItem(trackerStorageKey, JSON.stringify(savedTrackerRecords));
      return "";
    } catch (error) {
      savedTrackerRecords.pop();
      return `Reference ${request.id} was created but could not be saved for later tracking: ${error.message}`;
    }
  }

  function createReferenceId(prefix) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const randomPart = window.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12).toUpperCase() ||
      `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 12).toUpperCase();
    const id = `${prefix}-${timestamp}-${randomPart}`;
    return announcements.some((request) => request.id === id) ? createReferenceId(prefix) : id;
  }

  function applyRole(role) {
    if (!adminDashboard || !caregiverContext) return;
    const isAdmin = role === "admin";
    adminDashboard.hidden = !isAdmin;
    caregiverContext.hidden = role !== "caregiver";
    if (isAdmin) {
      adminDashboard.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (role === "caregiver" && assistanceSection) {
      assistanceSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (adminDashboard.dataset.wasOpen === "true" && mainContent) {
      mainContent.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    adminDashboard.dataset.wasOpen = String(isAdmin);
  }

  roleSelect?.addEventListener("change", (event) => {
    const destinations = { pwd: "pwd.html", caregiver: "caregiver.html", admin: "admin.html" };
    window.location.assign(destinations[event.target.value]);
  });
  document.querySelectorAll("[data-role]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!roleSelect) return;
      roleSelect.value = button.dataset.role;
      applyRole(button.dataset.role);
    });
  });
  const requestedRole = new URLSearchParams(window.location.search).get("role");
  if (roleSelect && ["pwd", "caregiver", "admin"].includes(requestedRole)) {
    roleSelect.value = requestedRole;
    applyRole(requestedRole);
  }
  document.querySelectorAll("[data-scroll]").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById(button.dataset.scroll)?.scrollIntoView({ behavior: "smooth" });
    });
  });

  const idModalElement = document.querySelector("#id-modal");
  document.querySelectorAll("[data-open-modal]").forEach((button) => {
    button.addEventListener("click", () => {
      if (window.bootstrap?.Modal && idModalElement) {
        window.bootstrap.Modal.getOrCreateInstance(idModalElement).show();
      } else if (idModalElement) {
        idModalElement.classList.add("show");
        idModalElement.style.display = "block";
        idModalElement.removeAttribute("aria-hidden");
        idModalElement.setAttribute("role", "dialog");
      }
    });
  });

  document.querySelectorAll(".filter-pill").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter-pill").forEach((pill) => {
        const selected = pill === button;
        pill.classList.toggle("active", selected);
        pill.setAttribute("aria-pressed", String(selected));
      });
      document.querySelectorAll(".announcement-card").forEach((card) => {
        card.hidden = button.dataset.filter !== "all" && card.dataset.category !== button.dataset.filter;
      });
    });
  });

  const trackingForm = document.querySelector("#tracking-form");
  const trackingResult = document.querySelector("#tracking-result");
  const trackerEmpty = document.querySelector("#tracker-empty");
  const trackingId = document.querySelector("#tracking-id");
  const trackingHelp = document.querySelector("#tracking-help");
  if (trackerStorageError && trackingHelp) trackingHelp.textContent = trackerStorageError;

  function statusClass(status) {
    if (status === "Received") return "status-received";
    if (status === "Update available") return "status-update";
    if (status === "Closed") return "status-closed";
    return "status-review";
  }

  function renderTracking(request) {
    if (!trackingResult || !trackerEmpty) return;
    const stage = request.status === "Received" ? 1 : request.status === "Under review" ? 2 : request.status === "Update available" ? 3 : 4;
    trackingResult.innerHTML = `
      <div class="tracked-request"><div><span class="request-ref">${escapeHtml(request.id)}</span><span class="request-type">${escapeHtml(request.type)} · ${escapeHtml(request.municipality)}</span></div><span class="status-badge ${statusClass(request.status)}"><i></i> ${escapeHtml(request.status)}</span></div>
      <div class="request-progress">${[1, 2, 3, 4].map((step) => `<span${step <= stage ? ' class="progress-done"' : ""}></span>`).join("")}</div>
      <div class="tracking-step-labels"><span>Received</span><span>In review</span><span>Update</span><span>Closed</span></div>
      ${request.explanation ? `<p class="status-explanation">${escapeHtml(request.explanation)}</p>` : ""}`;
    trackingResult.hidden = false;
    trackerEmpty.hidden = true;
  }

  trackingForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const searchId = trackingId.value.trim().toUpperCase();
    const request = announcements.find((item) => item.id.toUpperCase() === searchId);
    if (request) {
      renderTracking(request);
      trackingId.setAttribute("aria-invalid", "false");
    } else {
      trackingResult.hidden = true;
      trackerEmpty.hidden = false;
      trackingId.setAttribute("aria-invalid", "true");
    }
  });

  function addRequestToDashboard(request) {
    const requestsTable = document.querySelector("#admin-requests");
    const openCount = document.querySelector("#open-count");
    if (!requestsTable || !openCount) return;

    openCount.textContent = String(Number(openCount.textContent) + 1);
    const row = document.createElement("tr");
    row.dataset.id = request.id;
    row.innerHTML = `<td><strong>${escapeHtml(request.id)}</strong></td><td>${escapeHtml(request.type)}</td><td>${escapeHtml(request.municipality)}</td><td><span class="status-badge status-received"><i></i> Received</span></td><td><select class="form-select form-select-sm status-select" aria-label="Update status for ${escapeHtml(request.id)}"><option selected>Received</option><option>Under review</option><option>Update available</option><option>Closed</option></select></td>`;
    requestsTable.prepend(row);
  }

  const assistanceForm = document.querySelector("#assistance-form");
  const formFeedback = document.querySelector("#form-feedback");
  assistanceForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const requiredFields = [...assistanceForm.querySelectorAll("[required]")];
    let isValid = true;
    requiredFields.forEach((field) => {
      const fieldValid = field.type === "checkbox" ? field.checked : field.value.trim() !== "";
      field.classList.toggle("is-invalid", !fieldValid && field.type !== "checkbox");
      if (!fieldValid) isValid = false;
    });
    if (!isValid) {
      formFeedback.textContent = "Please complete the required fields and confirm that you have consent to create this request.";
      formFeedback.style.color = "#a34e43";
      const firstInvalid = requiredFields.find((field) => field.type === "checkbox" ? !field.checked : !field.value.trim());
      firstInvalid?.focus();
      return;
    }
    const formData = new FormData(assistanceForm);
    const request = {
      id: createReferenceId("EG-REQ"),
      type: formData.get("type"),
      municipality: formData.get("location").split(",")[0].trim(),
      status: "Received",
      explanation: "Assistance eligibility and approval are determined through the applicable program review."
    };
    const trackerError = saveTrackerRecord(request);
    formFeedback.style.color = "";
    formFeedback.textContent = trackerError || `Request reference ${request.id} created. Use this ID to check its status.`;
    assistanceForm.reset();
    renderTracking(request);
    if (trackingId) trackingId.value = request.id;
    addRequestToDashboard(request);
    const notificationError = addNotification(`New assistance request saved (${request.id}).`);
    if (notificationError) formFeedback.textContent += ` ${notificationError}`;
  });

  const idApplicationForm = document.querySelector("#id-application-form");
  const applicationTypeSelect = document.querySelector("#id-application-type");
  const documentUploadSection = document.querySelector("#id-document-fields");
  const oldPwdIdLost = document.querySelector("#old-pwd-id-lost");

  function updateRequiredDocumentFields() {
    if (!applicationTypeSelect || !documentUploadSection) return;
    const applicationType = applicationTypeSelect.value;
    documentUploadSection.hidden = false;
    documentUploadSection.querySelectorAll(".document-field").forEach((field) => {
      const groups = field.dataset.documentGroups.split(" ");
      const isAffidavitField = groups.includes("renewal-lost") || groups.includes("replacement");
      const showField = !applicationType || (isAffidavitField
        ? applicationType === "replacement" || (applicationType === "renewal" && oldPwdIdLost?.checked)
        : groups.includes(applicationType));
      field.hidden = !showField;
      const oldIdUpload = field.querySelector("#old-pwd-id-upload");
      if (oldIdUpload) oldIdUpload.hidden = applicationType === "renewal" && Boolean(oldPwdIdLost?.checked);
      const input = field.querySelector('input[type="file"]');
      if (input) {
        input.required = showField && (
          input.id !== "document-birth-marriage" &&
          input.id !== "document-whole-body" &&
          (input.id !== "document-affidavit-loss" || applicationType === "replacement" || (applicationType === "renewal" && oldPwdIdLost?.checked)) &&
          (input.id !== "document-old-pwd-id" || applicationType !== "renewal" || !oldPwdIdLost?.checked)
        );
      }
    });
  }

  applicationTypeSelect?.addEventListener("change", updateRequiredDocumentFields);
  oldPwdIdLost?.addEventListener("change", updateRequiredDocumentFields);
  updateRequiredDocumentFields();

  idApplicationForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const requiredFields = [...idApplicationForm.querySelectorAll("[required]")];
    let isValid = true;
    requiredFields.forEach((field) => {
      const fieldValid = field.type === "checkbox" ? field.checked : field.value.trim() !== "";
      field.classList.toggle("is-invalid", !fieldValid);
      if (!fieldValid) isValid = false;
    });
    const feedback = document.querySelector("#id-form-feedback");
    if (!isValid) {
      feedback.style.color = "#a34e43";
      feedback.textContent = "Complete the required fields and confirm the inquiry details are accurate.";
      requiredFields.find((field) => field.type === "checkbox" ? !field.checked : !field.value.trim())?.focus();
      return;
    }

    const formData = new FormData(idApplicationForm);
    const applicationType = applicationTypeSelect.value;
    const applicationReferencePrefix = applicationType === "new" ? "PID-NEW" :
      applicationType === "renewal" ? "PID-REN" : "PID-LOST";
    const request = {
      id: createReferenceId(applicationReferencePrefix),
      type: applicationTypeSelect.selectedOptions?.[0]?.textContent || (
        applicationTypeSelect.value === "new" ? "New PWD ID application" :
          applicationTypeSelect.value === "renewal" ? "PWD ID renewal" : "Replacement for lost PWD ID"
      ),
      municipality: formData.get("municipality"),
      status: "Received",
      explanation: "Your inquiry is ready for application review."
    };
    const trackerError = saveTrackerRecord(request);
    feedback.style.color = "";
    feedback.textContent = `PWD ID inquiry reference ${request.id} created.`;
    if (trackerError) feedback.textContent += ` ${trackerError}`;
    idApplicationForm.reset();
    updateRequiredDocumentFields();
    renderTracking(request);
    if (trackingId) trackingId.value = request.id;
    addRequestToDashboard(request);
    window.bootstrap?.Modal.getInstance(document.querySelector("#id-modal"))?.hide();
    const notificationError = addNotification(`New PWD ID inquiry created (${request.id}).`);
    if (notificationError) feedback.textContent += ` ${notificationError}`;
  });

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  const communityAnnouncementKey = "egabay-community-announcements";
  const defaultCommunityNotices = [
    {
      id: "notice-free-supplies",
      title: "Free basic supplies distribution",
      date: "2026-11-10",
      category: "assistance",
      details: "Free hygiene kits and basic household supplies for PWD residents, while supplies last.",
      location: "Boac Municipal Covered Court",
    },
    {
      id: "notice-accessible-activities",
      title: "Inclusive community day",
      date: "2026-11-18",
      category: "programs",
      details: "An accessible day featuring information booths, recreation, and service referrals for PWD residents and families.",
      location: "Mogpog Municipal Gymnasium",
    },
    {
      id: "notice-caregiver-support",
      title: "Caregiver information session",
      date: "2026-11-25",
      category: "general",
      details: "A short session on caregiving resources, available referrals, and preparing for appointments.",
      location: "Gasan Municipal Hall",
    }
  ];
  const announcementCategoryLabels = {
    assistance: "Assistance",
    programs: "Community programs",
    general: "General information"
  };
  const announcementCategoryClasses = {
    assistance: "coral",
    programs: "sage",
    general: "gold"
  };
  const announcementList = document.querySelector("#announcement-list");
  const announcementEmpty = document.querySelector("#announcement-empty");
  const announcementForm = document.querySelector("#announcement-form");
  const announcementFeedback = document.querySelector("#announcement-feedback");

  function loadCommunityAnnouncements() {
    try {
      const saved = window.localStorage.getItem(communityAnnouncementKey);
      if (saved === null) return { items: defaultCommunityNotices, error: "" };
      const items = JSON.parse(saved);
      if (!Array.isArray(items) || items.some((item) =>
        !item || typeof item.id !== "string" ||
        typeof item.title !== "string" ||
        typeof item.details !== "string" ||
        typeof item.location !== "string" ||
        (item.date !== undefined && typeof item.date !== "string") ||
        !Object.hasOwn(announcementCategoryLabels, item.category)
      )) {
        return { items: [], error: "Saved announcements are invalid. Clear this browser's site data to reset them." };
      }
      return { items, error: "" };
    } catch (error) {
      return { items: [], error: `Announcements could not be loaded from browser storage: ${error.message}` };
    }
  }

  function renderCommunityAnnouncements(items) {
    if (!announcementList) return;
    announcementList.querySelectorAll(".user-announcement").forEach((item) => item.remove());
    const newCards = document.createDocumentFragment();
    items.forEach((announcement) => {
      const column = document.createElement("div");
      column.className = "col-md-6 col-lg-4 announcement-card user-announcement";
      column.dataset.category = announcement.category;

      const article = document.createElement("article");
      article.className = "update-card";
      const top = document.createElement("div");
      top.className = "update-card-top";
      const category = document.createElement("span");
      category.className = `update-category ${announcementCategoryClasses[announcement.category]}`;
      category.textContent = announcementCategoryLabels[announcement.category];
      const icon = document.createElement("span");
      icon.className = "update-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = announcement.category === "assistance" ? "✚" : announcement.category === "programs" ? "✳" : "i";
      top.append(category, icon);

      const title = document.createElement("h3");
      title.textContent = announcement.title;
      const details = document.createElement("p");
      details.textContent = announcement.details;
      const meta = document.createElement("div");
      meta.className = "update-meta";
      const date = document.createElement("span");
      const announcementDate = announcement.date || announcement.createdAt;
      date.textContent = announcementDate
        ? new Date(`${announcementDate.slice(0, 10)}T00:00:00`).toLocaleDateString()
        : "Date not specified";
      const location = document.createElement("span");
      location.textContent = announcement.location || "Place not specified";
      meta.append(date, location);

      article.append(top, title, details, meta);
      column.append(article);
      newCards.append(column);
    });
    announcementList.prepend(newCards);

    if (announcementEmpty) {
      announcementEmpty.hidden = announcementList.querySelectorAll(".announcement-card").length > 0;
    }
    const noticeCount = document.querySelector("#notice-count");
    if (noticeCount) noticeCount.textContent = String(items.length);
  }

  const savedAnnouncements = loadCommunityAnnouncements();
  renderCommunityAnnouncements(savedAnnouncements.items);
  if (savedAnnouncements.error) {
    if (announcementFeedback) announcementFeedback.textContent = savedAnnouncements.error;
    if (announcementEmpty) {
      announcementEmpty.textContent = savedAnnouncements.error;
      announcementEmpty.hidden = false;
    }
  }

  announcementForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    announcementFeedback.textContent = "";
    if (!announcementForm.reportValidity()) return;

    const formData = new FormData(announcementForm);
    const announcement = {
      id: `announcement-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: formData.get("title").trim(),
      date: formData.get("date"),
      category: formData.get("category"),
      details: formData.get("details").trim(),
      location: formData.get("location").trim(),
      createdAt: new Date().toISOString()
    };
    const latestAnnouncements = loadCommunityAnnouncements();
    if (latestAnnouncements.error) {
      announcementFeedback.textContent = latestAnnouncements.error;
      return;
    }

    latestAnnouncements.items.unshift(announcement);
    try {
      window.localStorage.setItem(communityAnnouncementKey, JSON.stringify(latestAnnouncements.items));
    } catch (error) {
      announcementFeedback.textContent = `Announcement could not be saved in browser storage: ${error.message}`;
      return;
    }

    renderCommunityAnnouncements(latestAnnouncements.items);
    announcementForm.reset();
    announcementFeedback.textContent = "Announcement added to this browser. It is now visible on the PWD and caregiver portals here.";
    const notificationError = addNotification(`New community announcement: ${announcement.title}`);
    if (notificationError) announcementFeedback.textContent += ` ${notificationError}`;
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== communityAnnouncementKey) return;
    const latestAnnouncements = loadCommunityAnnouncements();
    renderCommunityAnnouncements(latestAnnouncements.items);
    if (latestAnnouncements.error) {
      if (announcementFeedback) announcementFeedback.textContent = latestAnnouncements.error;
      if (announcementEmpty) {
        announcementEmpty.textContent = latestAnnouncements.error;
        announcementEmpty.hidden = false;
      }
    }
  });

  const statusConfirmModal = document.querySelector("#status-confirm-modal");
  const statusConfirmMessage = document.querySelector("#status-confirm-message");
  const statusConfirmCancel = document.querySelector("#status-confirm-cancel");
  const statusConfirmApply = document.querySelector("#status-confirm-apply");
  let pendingStatusChange = null;

  function closeStatusConfirmation() {
    if (!statusConfirmModal || !pendingStatusChange) return;
    const { select } = pendingStatusChange;
    statusConfirmModal.hidden = true;
    pendingStatusChange = null;
    select.focus();
  }

  function applyStatusChange() {
    if (!pendingStatusChange) return;
    const { request, row, select, nextStatus } = pendingStatusChange;
    select.value = nextStatus;
    request.status = nextStatus;
    request.explanation = `Request status updated to ${request.status}.`;
    row.children[3].innerHTML = `<span class="status-badge ${statusClass(request.status)}"><i></i> ${request.status}</span>`;
    document.querySelector("#admin-feedback").textContent = `Status for ${request.id} changed to ${request.status}.`;
    if (trackingId?.value.trim().toUpperCase() === request.id) renderTracking(request);
    const notificationError = addNotification(`Request status updated: ${request.id} is now ${request.status}.`);
    if (notificationError) document.querySelector("#admin-feedback").textContent += ` ${notificationError}`;
    closeStatusConfirmation();
  }

  statusConfirmCancel?.addEventListener("click", closeStatusConfirmation);
  statusConfirmApply?.addEventListener("click", applyStatusChange);
  statusConfirmModal?.addEventListener("click", (event) => {
    if (event.target === statusConfirmModal) closeStatusConfirmation();
  });
  document.addEventListener("keydown", (event) => {
    if (!pendingStatusChange) return;
    if (event.key === "Escape") {
      closeStatusConfirmation();
      return;
    }
    if (event.key === "Tab") {
      const focusable = [statusConfirmCancel, statusConfirmApply].filter(Boolean);
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
        event.preventDefault();
        focusable[0].focus();
      }
    }
  });

  document.querySelector("#admin-requests")?.addEventListener("change", (event) => {
    if (!event.target.matches(".status-select")) return;
    const statusSelect = event.target;
    const row = event.target.closest("tr");
    const request = announcements.find((item) => item.id === row.dataset.id);
    if (!request) return;
    const originalStatus = row.children[3].textContent.trim();
    const nextStatus = statusSelect.value;
    statusSelect.value = originalStatus;
    if (!statusConfirmModal || !statusConfirmMessage || !statusConfirmApply) return;
    pendingStatusChange = { request, row, select: statusSelect, nextStatus };
    statusConfirmMessage.textContent = `Change ${request.id} from "${originalStatus}" to "${nextStatus}"?`;
    statusConfirmModal.hidden = false;
    statusConfirmApply.focus();
  });

})();
