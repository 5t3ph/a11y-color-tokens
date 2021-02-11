#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const a11yColor = require("a11ycolor");
const Color = require("color");
const options = require("yargs-parser")(process.argv.slice(2));

const cssOutputFilename = "color-tokens.css";
const defaults = {
  outputDirPath: "sass",
  outputFilename: "_color-tokens.scss",
  colorTokensPath: "color-tokens.js",
  tokenOutputFormat: "sass", // "css"
  sassOutputName: "color-tokens",
  tokenPrefix: "color-",
  compatibilityDocs: true,
  compatibilityDocsPath: "outputDirPath",
  includeCustomProperties: true,
  customPropertiesFormat: "mixin", // || "root"
};

const {
  outputDirPath,
  outputFilename,
  colorTokensPath,
  tokenOutputFormat,
  sassOutputName,
  tokenPrefix,
  compatibilityDocs,
  compatibilityDocsPath,
  includeCustomProperties,
  customPropertiesFormat,
} = {
  ...defaults,
  ...options,
};

let colorTokensFile = path.resolve(__dirname, fs.realpathSync(colorTokensPath));
if (!fs.existsSync(colorTokensFile)) {
  console.log("Invalid colorTokensFile provided");
  process.exit(1);
}
const themeColors = require(colorTokensFile);

const checkContrast = (foreground, background = "#fff") => {
  const colorValue = Color(foreground);
  // Determine contrast against white as a baseline
  return colorValue.contrast(Color(background));
};

// @link https://css-tricks.com/snippets/javascript/lighten-darken-color/
const onColorTone = (color, amount) => {
  let usePound = false;

  if (color[0] == "#") {
    color = color.slice(1);
    usePound = true;
  }

  const num = parseInt(color, 16);

  let r = (num >> 16) + amount;

  if (r > 255) r = 255;
  else if (r < 0) r = 0;

  let b = ((num >> 8) & 0x00ff) + amount;

  if (b > 255) b = 255;
  else if (b < 0) b = 0;

  let g = (num & 0x0000ff) + amount;

  if (g > 255) g = 255;
  else if (g < 0) g = 0;

  return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16);
};

const onColorContrast = (color, ratioKey) => {
  const contrast = checkContrast(color);
  const contrastRatio = ratioKey === "large" ? 3 : 4.5;
  // Alter the color darker or lighter
  let onColor =
    contrast >= contrastRatio
      ? onColorTone(color, 60)
      : onColorTone(color, -60);
  // Make sure `onColor` value meets ratioKey threshold
  return a11yColor(onColor, color, ($ratioKey = ratioKey));
};

const colorOutput = (colors, prefix, eol, join, type) => {
  return colors
    .map(({ name, color, warn }) => {
      const warning = warn
        ? `/* 🚫 Contrast fails against ${name.split("-")[2]} */\n`
        : "";
      let colorValue = type === "map" ? `$${name}` : color;
      colorValue = type === "mixin" ? `#{$${name}}` : colorValue;
      return `${warning}${prefix}${name}${
        prefix == '"' ? '"' : ""
      }: ${colorValue}${eol}`;
    })
    .join(join);
};

const generateContrastDocs = (colors) => {
  let compatibilityResults = "# Contrast Safe Combinations\n\n";
  compatibilityResults +=
    "> The following are contrast safe combinations as calculated for _normal_ text based on WCAG AA 4.5\n";
  colors.map(({ name, color }) => {
    const rest = colors.filter((c) => c.color !== color);
    const restResults = rest
      .map((oc) => {
        const passing = checkContrast(color, oc.color) > 4.5;
        return passing ? oc.name : null;
      })
      .filter((c) => c);
    compatibilityResults += `\n## ${name}\n  - ${
      restResults.length
        ? `\`${restResults.join("`\n  - `")}\``
        : "No safe options"
    }\n`;
  });

  return compatibilityResults;
};

(async () => {
  let colors = [];
  const prefix = tokenPrefix || "";

  themeColors.map(({ name, color, onColor, ratioKey = "small" }) => {
    colors.push({ name: `${prefix}${name}`, color });

    const contrastRatio = ratioKey === "large" ? 3 : 4.5;
    let onColorValue = onColor;
    if (onColor !== false) {
      let warn = false;
      if (!onColorValue) {
        onColorValue = onColorContrast(Color(color).hex(), ratioKey);
      } else {
        warn =
          checkContrast(onColorValue, color) >= contrastRatio ? false : true;
      }
      colors.push({
        name: `${prefix}on-${name}`,
        color: onColorValue,
        warn,
      });
    }
  });

  let tokenOutput = "";

  if (tokenOutputFormat === "sass") {
    tokenOutput = colorOutput(colors, "$", " !default;", "\n");

    tokenOutput += `\n\n$${sassOutputName}: (
  ${colorOutput(colors, '"', "", ",\n  ", "map")}
) !default;`;
  }

  let themeColorOutput = `/* 🛑 STOP!\n  Do not change this file directly.\n  Modify colors in ${colorTokensPath}\n */`;

  themeColorOutput += `\n\n${tokenOutput}`;

  if (includeCustomProperties || tokenOutputFormat === "css") {
    if (tokenOutputFormat === "css" || customPropertiesFormat === "root") {
      themeColorOutput += `\n\n:root {\n  ${colorOutput(
        colors,
        "--",
        ";",
        "\n  ",
        tokenOutputFormat === "sass" && "mixin"
      )}\n}`;
    } else {
      themeColorOutput += `\n\n@mixin ${sassOutputName}() {\n  ${colorOutput(
        colors,
        "--",
        ";",
        "\n  ",
        "mixin"
      )}\n}`;
    }
  }

  const filename =
    tokenOutputFormat === "sass" ? outputFilename : cssOutputFilename;
  let themeColorsFilePath = path.resolve(
    __dirname,
    fs.realpathSync(outputDirPath)
  );
  if (!fs.existsSync(themeColorsFilePath)) {
    console.log("Invalid outputDirPath provided");
    process.exit(1);
  }
  fs.writeFileSync(`${themeColorsFilePath}/${filename}`, themeColorOutput, {
    flag: "w",
  });

  if (compatibilityDocs) {
    const docs = generateContrastDocs(colors);
    let docsPath = `${themeColorsFilePath}/_color-token-contrast.md`;

    if (compatibilityDocsPath !== "outputDirPath") {
      docsPath = `${compatibilityDocsPath}/color-token-contrast.md`;
    }

    fs.writeFileSync(docsPath, docs, {
      flag: "w",
    });
  }
})();
