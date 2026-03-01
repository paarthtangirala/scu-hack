/**
 * Pure validation utilities for the household listing flow.
 * No React, no side effects, no API calls.
 * Owner: Sara
 *
 * Field names mirror backend/models/listing.py and backend/models/material.py.
 */

/** Maximum allowed length for the notes field (not enforced by backend; defined here). */
export const MAX_NOTES_LENGTH = 500;

/** Maximum lbs per material line (not enforced by backend; defined here for safety). */
export const MAX_LBS = 5000;

/**
 * Validate a file selected for photo upload.
 * Accepts any object with a .type string (e.g. a File, or a plain mock object).
 *
 * @param {File|null|undefined} file
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateImageFile(file) {
  if (file == null) {
    return { valid: false, error: 'No file selected. Please choose a photo to upload.' };
  }
  if (typeof file.type !== 'string' || !file.type.startsWith('image/')) {
    return {
      valid: false,
      error: `File type "${file.type}" is not accepted. Please upload an image file (JPEG, PNG, WebP, etc.).`,
    };
  }
  return { valid: true, error: null };
}

/**
 * Validate the materials array collected from PhotoUpload AI results or ManualMaterials.
 * Each material must have a non-empty type string and a positive finite lbs ≤ MAX_LBS.
 *
 * @param {Array<{type: string, lbs: number}>} materials
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateMaterials(materials) {
  if (!Array.isArray(materials) || materials.length === 0) {
    return { valid: false, errors: ['Add at least one material before posting.'] };
  }

  const errors = [];
  materials.forEach((m, idx) => {
    const label = m.type ? `"${m.type}"` : `item ${idx + 1}`;

    if (!m.type || typeof m.type !== 'string' || m.type.trim() === '') {
      errors.push(`Material ${idx + 1}: type must be a non-empty string.`);
    }

    const lbs = m.lbs;
    if (typeof lbs !== 'number' || !isFinite(lbs) || isNaN(lbs)) {
      errors.push(`${label}: lbs must be a number.`);
    } else if (lbs <= 0) {
      errors.push(`${label}: lbs must be greater than 0.`);
    } else if (lbs > MAX_LBS) {
      errors.push(`${label}: lbs cannot exceed ${MAX_LBS} (entered ${lbs}).`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Validate the notes field.
 * Notes are optional — empty string is valid.
 * Rejects strings longer than MAX_NOTES_LENGTH.
 *
 * @param {string|null|undefined} notes
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateNotes(notes) {
  if (notes == null || notes === '') {
    return { valid: true, error: null };
  }
  if (typeof notes !== 'string') {
    return { valid: false, error: 'Notes must be a string.' };
  }
  if (notes.length > MAX_NOTES_LENGTH) {
    return {
      valid: false,
      error: `Notes cannot exceed ${MAX_NOTES_LENGTH} characters (currently ${notes.length}).`,
    };
  }
  return { valid: true, error: null };
}

/**
 * Validate a full listing object before submission.
 * Covers required fields from backend/models/listing.py:
 *   address (str), household_name (str), listing_kind (str), notes (str), materials (list).
 * lat/lng are auto-assigned by HouseholdPage so not validated here.
 * phone is optional in the backend model so not required here.
 *
 * @param {object} listing
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateListing(listing) {
  if (!listing || typeof listing !== 'object') {
    return { valid: false, errors: ['Listing must be a valid object.'] };
  }

  const errors = [];

  // Required: address
  if (!listing.address || typeof listing.address !== 'string' || listing.address.trim() === '') {
    errors.push('address is required.');
  }

  // Required: household_name (maps to form.name in HouseholdPage)
  if (
    !listing.household_name ||
    typeof listing.household_name !== 'string' ||
    listing.household_name.trim() === ''
  ) {
    errors.push('household_name is required.');
  }

  // Optional: listing_kind must be "household" or "business" when provided
  if (
    listing.listing_kind !== undefined &&
    !['household', 'business'].includes(listing.listing_kind)
  ) {
    errors.push('listing_kind must be "household" or "business".');
  }

  // Optional: notes (with length limit)
  const notesResult = validateNotes(listing.notes);
  if (!notesResult.valid) {
    errors.push(notesResult.error);
  }

  // Required: materials (at least one valid material)
  const matsResult = validateMaterials(listing.materials);
  if (!matsResult.valid) {
    errors.push(...matsResult.errors);
  }

  return { valid: errors.length === 0, errors };
}
