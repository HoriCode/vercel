(() => {
  const form = document.querySelector("#auth-form");
  const nameInput = document.querySelector("#account-name");
  const nameField = document.querySelector("#name-field");
  const patientNameInput = document.querySelector("#patient-name");
  const patientNameField = document.querySelector("#patient-name-field");
  const roleSelect = document.querySelector("#account-role");
  const passwordInput = document.querySelector("#account-password");
  const submitButton = document.querySelector("#auth-submit");
  const feedback = document.querySelector("#auth-feedback");
  let mode = "login";

  function updatePatientNameField() {
    const showPatientName = mode === "register" && roleSelect.value === "caregiver";
    patientNameField.hidden = !showPatientName;
    patientNameInput.required = showPatientName;
  }

  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      mode = tab.dataset.mode;
      const registering = mode === "register";
      document.querySelectorAll(".auth-tab").forEach((item) => {
        const selected = item === tab;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      nameField.hidden = !registering;
      nameInput.required = registering;
      updatePatientNameField();
      passwordInput.autocomplete = registering ? "new-password" : "current-password";
      submitButton.textContent = "Continue to portal";
      feedback.textContent = "";
    });
  });

  roleSelect.addEventListener("change", updatePatientNameField);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    feedback.textContent = "";
    if (!form.reportValidity()) return;

    if (mode === "register" && !nameInput.value.trim()) {
      feedback.textContent = "Enter your name to continue.";
      nameInput.focus();
      return;
    }

    const destinations = {
      pwd: "pwd.html",
      caregiver: "caregiver.html",
      staff: "admin.html"
    };
    const role = roleSelect.value;
    try {
      if (mode === "register") {
        window.sessionStorage.setItem("egabay-account-name", nameInput.value.trim());
      } else {
        window.sessionStorage.removeItem("egabay-account-name");
      }
      if (mode === "register" && role === "caregiver") {
        window.sessionStorage.setItem("egabay-caregiver-patient-name", patientNameInput.value.trim());
      } else {
        window.sessionStorage.removeItem("egabay-caregiver-patient-name");
      }
      window.sessionStorage.setItem("egabay-account-role", role);
    } catch (error) {
      feedback.textContent = `Account details could not be saved for this session: ${error.message}`;
      return;
    }
    window.location.assign(destinations[role]);
  });
})();
