import {
  Autocomplete,
  Badge,
  Drawer,
  Modal,
  MultiSelect,
  Select,
  TagsInput,
  createTheme,
  type CSSVariablesResolver,
  type MantineColorsTuple,
} from '@mantine/core';
import { DateInput, DatePickerInput, DateTimePicker } from '@mantine/dates';

/** Black, for buttons and other main controls (shade 6 is the ink colour, 7 its hover). */
const ink: MantineColorsTuple = ['#f4f4f4', '#e9e9e9', '#d4d4d4', '#b8b8b8', '#8f8f8f', '#5f5f5f', '#1c1c1c', '#3a3a3a', '#111111', '#000000'];

/** Drafting blue: links, line drawings and highlights. Shade 6 is 6.3:1 on white. */
const blueprint: MantineColorsTuple = ['#eef1fd', '#dce3fb', '#b7c5f6', '#90a6f1', '#6e8aec', '#5274e8', '#2b50e0', '#2443c2', '#1e379f', '#182c7d'];

/*
 * Mantine's default shade 6 of each colour (used for coloured text, badges, alerts and filled buttons)
 * is too light to meet the WCAG AA contrast ratio of 4.5:1 for normal-size text. These palettes keep
 * Mantine's light shades and replace 6 to 9 with darker ones that pass on white, on light grey and on
 * their own pale tints. Grey is neutral (no blue tint); its shade 6 is the "dimmed" secondary text colour.
 */
const gray: MantineColorsTuple = ['#fafafa', '#f4f4f4', '#ebebeb', '#e3e3e3', '#cfcfcf', '#adadad', '#5f5f5f', '#474747', '#333333', '#1c1c1c'];
const red: MantineColorsTuple = ['#fff5f5', '#ffe3e3', '#ffc9c9', '#ffa8a8', '#ff8787', '#ff6b6b', '#c92a2a', '#b02525', '#962020', '#7d1a1a'];
const orange: MantineColorsTuple = ['#fff4e6', '#ffe8cc', '#ffd8a8', '#ffc078', '#ffa94d', '#ff922b', '#b43c0b', '#9c340a', '#842c08', '#6c2407'];
const green: MantineColorsTuple = ['#ebfbee', '#d3f9d8', '#b2f2bb', '#8ce99a', '#69db7c', '#51cf66', '#13773a', '#116832', '#0e592b', '#0c4a24'];
const blue: MantineColorsTuple = ['#e7f5ff', '#d0ebff', '#a5d8ff', '#74c0fc', '#4dabf7', '#339af0', '#1864ab', '#155897', '#124c83', '#0f406f'];
const yellow: MantineColorsTuple = ['#fff9db', '#fff3bf', '#ffec99', '#ffe066', '#ffd43b', '#fcc419', '#8a6100', '#785400', '#664700', '#543a00'];
const teal: MantineColorsTuple = ['#e6fcf5', '#c3fae8', '#96f2d7', '#63e6be', '#38d9a9', '#20c997', '#0f766e', '#0d655e', '#0b554f', '#09443f'];

const sans = "'Host Grotesk Variable', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const mono = "'Azeret Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export const theme = createTheme({
  primaryColor: 'ink',
  primaryShade: 6,
  colors: { ink, blueprint, gray, red, orange, green, blue, yellow, teal },
  black: '#1c1c1c',
  fontFamily: sans,
  fontFamilyMonospace: mono,
  // Page titles (h1) use the serif; see globals.css.
  headings: { fontFamily: sans, fontWeight: '600' },
  radius: { xs: '2px', sm: '4px', md: '6px', lg: '10px', xl: '16px' },
  defaultRadius: 'sm',
  // Hairlines do most of the work; shadows are kept faint.
  shadows: {
    xs: '0 1px 2px rgba(0, 0, 0, 0.04)',
    sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
    md: '0 4px 16px rgba(0, 0, 0, 0.06)',
    lg: '0 10px 32px rgba(0, 0, 0, 0.08)',
    xl: '0 10px 64px rgba(0, 0, 0, 0.12)',
  },
  cursorType: 'pointer',
  components: {
    // Tags are quiet: tinted, sentence case, small corners.
    Badge: Badge.extend({
      defaultProps: { variant: 'light', radius: 'sm' },
      styles: { root: { textTransform: 'none', letterSpacing: 0, fontWeight: 500 } },
    }),
    // Close buttons are icons only, so they need a name for screen readers.
    Modal: Modal.extend({ defaultProps: { closeButtonProps: { 'aria-label': 'Close' } } }),
    Drawer: Drawer.extend({ defaultProps: { closeButtonProps: { 'aria-label': 'Close' } } }),
    // So are the "clear" buttons inside inputs.
    Select: Select.extend({ defaultProps: { clearButtonProps: { 'aria-label': 'Clear' } } }),
    MultiSelect: MultiSelect.extend({ defaultProps: { clearButtonProps: { 'aria-label': 'Clear' } } }),
    Autocomplete: Autocomplete.extend({ defaultProps: { clearButtonProps: { 'aria-label': 'Clear' } } }),
    TagsInput: TagsInput.extend({ defaultProps: { clearButtonProps: { 'aria-label': 'Clear' } } }),
    DateInput: DateInput.extend({ defaultProps: { clearButtonProps: { 'aria-label': 'Clear date' } } }),
    DatePickerInput: DatePickerInput.extend({ defaultProps: { clearButtonProps: { 'aria-label': 'Clear date' } } }),
    DateTimePicker: DateTimePicker.extend({ defaultProps: { clearButtonProps: { 'aria-label': 'Clear date and time' } } }),
  },
});

/** Links are drafting blue rather than the black of the buttons. */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: { '--mantine-color-anchor': 'var(--mantine-color-blueprint-6)' },
  dark: {},
});
