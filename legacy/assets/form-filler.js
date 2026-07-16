/*
 * Form-readiness progress tracking for the IBPS PO Pre Form-Filling tool.
 * Counts how many `.form-field` inputs are filled / checked and reflects
 * that as a percentage in the progress bar.
 */
(function () {
  const formFields = document.querySelectorAll(".form-field");
  const progressBar = document.getElementById("progress-bar");
  const progressText = document.getElementById("progress-text");

  if (!progressBar || !progressText) return;

  function updateProgress() {
    let filledFields = 0;
    const totalFields = formFields.length;

    formFields.forEach((field) => {
      if (field.type === "checkbox") {
        if (field.checked) filledFields++;
      } else if (field.value.trim() !== "") {
        filledFields++;
      }
    });

    const percentage = totalFields
      ? Math.round((filledFields / totalFields) * 100)
      : 0;
    progressBar.style.width = `${percentage}%`;
    progressText.textContent = `${percentage}%`;

    if (percentage === 100) {
      progressBar.classList.remove("bg-primary");
      progressBar.classList.add("bg-tertiary");
      progressText.classList.remove("text-primary");
      progressText.classList.add("text-tertiary");
    } else {
      progressBar.classList.add("bg-primary");
      progressBar.classList.remove("bg-tertiary");
      progressText.classList.add("text-primary");
      progressText.classList.remove("text-tertiary");
    }
  }

  formFields.forEach((field) => {
    field.addEventListener("input", updateProgress);
    field.addEventListener("change", updateProgress);
  });

  // Initial call
  updateProgress();
})();
