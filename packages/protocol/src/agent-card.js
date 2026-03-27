const NAME_REGEX = /^[a-zA-Z0-9-]+$/;
const MAX_NAME_LENGTH = 64;
const REQUIRED_CARD_FIELDS = ['name', 'description', 'version', 'protocolVersion', 'capabilities', 'skills', 'defaultInputModes', 'defaultOutputModes'];
const REQUIRED_SKILL_FIELDS = ['id', 'name', 'description', 'tags'];

export function validateAgentCard(card) {
  const errors = [];
  for (const field of REQUIRED_CARD_FIELDS) {
    if (card[field] === undefined || card[field] === null) { errors.push(`${field} is required`); }
  }
  if (errors.length > 0) return { valid: false, errors };

  if (typeof card.name !== 'string' || !NAME_REGEX.test(card.name)) {
    errors.push('name must be alphanumeric + hyphens only');
  } else if (card.name.length > MAX_NAME_LENGTH) {
    errors.push(`name must be ${MAX_NAME_LENGTH} chars or less`);
  }

  if (!Array.isArray(card.skills) || card.skills.length === 0) {
    errors.push('skills must contain at least one skill');
  } else {
    for (let i = 0; i < card.skills.length; i++) {
      const skill = card.skills[i];
      for (const field of REQUIRED_SKILL_FIELDS) {
        if (skill[field] === undefined || skill[field] === null) { errors.push(`skill[${i}].${field} is required`); }
      }
    }
  }

  if (!Array.isArray(card.defaultInputModes) || card.defaultInputModes.length === 0) errors.push('defaultInputModes must be a non-empty array');
  if (!Array.isArray(card.defaultOutputModes) || card.defaultOutputModes.length === 0) errors.push('defaultOutputModes must be a non-empty array');

  return { valid: errors.length === 0, errors };
}
