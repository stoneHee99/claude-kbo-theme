const { TEAMS, ORIGINAL_COLOR } = require("./teams");

const COLUMN_PATTERN = 'flexDirection:"column"},w,D,M)';

function findCreateElementVar(js) {
  const idx = js.indexOf(COLUMN_PATTERN);
  if (idx === -1) return null;

  const before = js.substring(Math.max(0, idx - 100), idx);
  const match = before.match(/(\w+)\.createElement\(\w+,\{$/);
  if (!match) return null;

  return match[1];
}

function findBoxVar(js) {
  // Find the Box var name from the column creation: VAR.createElement(BOXVAR,{flexDirection:"column"
  const idx = js.indexOf(COLUMN_PATTERN);
  if (idx === -1) return null;
  const before = js.substring(Math.max(0, idx - 100), idx);
  const match = before.match(/\.createElement\((\w+),\{$/);
  if (!match) return null;
  return match[1];
}

function patchJS(jsSource, teamId) {
  const team = TEAMS[teamId];
  if (!team) throw new Error(`Unknown team: ${teamId}`);

  let js = jsSource;

  const ceVar = findCreateElementVar(js);
  const boxVar = findBoxVar(js);
  if (!ceVar || !boxVar) {
    throw new Error("Could not find Clawd column layout pattern");
  }

  // Hat wrapped in a row Box that justifies center:
  //   Box(justifyContent:"center") { Text(▄█<logo>█▄) }
  // Pyramid shape: hat (6) < eyes (8) < arms (9)
  //   hat: "▄█▜▛█▄" wrapped in Box(justifyContent:"center")
  const hatInner = team.logo
    ? `${ceVar}.createElement(L,{color:"clawd_body"},"\\u2584\\u2588",${ceVar}.createElement(L,{color:"${team.logoColor}",backgroundColor:"clawd_body"},"${team.logoPixel}"),"\\u2588\\u2584")`
    : `${ceVar}.createElement(L,{color:"clawd_body"},"\\u2584\\u2588\\u2588\\u2588\\u2588\\u2588\\u2584")`;

  const hatCode = `${ceVar}.createElement(${boxVar},{justifyContent:"center"},${hatInner}),`;

  const columnWithHat = `flexDirection:"column"},${hatCode}w,D,M)`;

  const hatCount = js.split(COLUMN_PATTERN).length - 1;
  js = js.split(COLUMN_PATTERN).join(columnWithHat);

  // Apply team color
  const colorCount = js.split(ORIGINAL_COLOR).length - 1;
  js = js.split(ORIGINAL_COLOR).join(team.color);

  // Apply eye color (clawd_background) if specified
  let eyeCount = 0;
  if (team.eyeColor) {
    const ORIGINAL_EYE = 'clawd_background:"rgb(0,0,0)"';
    const newEye = `clawd_background:"${team.eyeColor}"`;
    eyeCount = js.split(ORIGINAL_EYE).length - 1;
    js = js.split(ORIGINAL_EYE).join(newEye);
  }

  return { js, hatCount, colorCount, eyeCount, ceVar };
}

module.exports = { patchJS };
