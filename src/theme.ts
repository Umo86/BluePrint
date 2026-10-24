import { Autocomplete, Drawer, Modal, MultiSelect, Select, TagsInput, createTheme, type MantineColorsTuple } from '@mantine/core';
import { DateInput, DatePickerInput, DateTimePicker } from '@mantine/dates';

const blueprint: MantineColorsTuple = [
  '#edf1fc',
  '#d9e0f3',
  '#b0bfe6',
  '#849cd9',
  '#607fce',
  '#496cc8',
  '#3c62c6',
  '#2e52af',
  '#26489d',
  '#1a3d8b',
];

/*
 * Mantine's default shade 6 of each colour (used for coloured text, badges, alerts and filled buttons)
 * is too light to meet the WCAG AA contrast ratio of 4.5:1 for normal-size text. These palettes keep
 * Mantine's light shades and replace 6 to 9 with darker ones that pass on white, on light grey and on
 * their own pale tints. (Grey shade 6 is also the "dimmed" secondary text colour.)
 */
const gray: MantineColorsTuple = ['#f8f9fa', '#f1f3f5', '#e9ecef', '#dee2e6', '#ced4da', '#adb5bd', '#61686f', '#495057', '#343a40', '#212529'];
const red: MantineColorsTuple = ['#fff5f5', '#ffe3e3', '#ffc9c9', '#ffa8a8', '#ff8787', '#ff6b6b', '#c92a2a', '#b02525', '#962020', '#7d1a1a'];
const orange: MantineColorsTuple = ['#fff4e6', '#ffe8cc', '#ffd8a8', '#ffc078', '#ffa94d', '#ff922b', '#b43c0b', '#9c340a', '#842c08', '#6c2407'];
const green: MantineColorsTuple = ['#ebfbee', '#d3f9d8', '#b2f2bb', '#8ce99a', '#69db7c', '#51cf66', '#13773a', '#116832', '#0e592b', '#0c4a24'];
const blue: MantineColorsTuple = ['#e7f5ff', '#d0ebff', '#a5d8ff', '#74c0fc', '#4dabf7', '#339af0', '#1864ab', '#155897', '#124c83', '#0f406f'];
const yellow: MantineColorsTuple = ['#fff9db', '#fff3bf', '#ffec99', '#ffe066', '#ffd43b', '#fcc419', '#8a6100', '#785400', '#664700', '#543a00'];
const teal: MantineColorsTuple = ['#e6fcf5', '#c3fae8', '#96f2d7', '#63e6be', '#38d9a9', '#20c997', '#0f766e', '#0d655e', '#0b554f', '#09443f'];

export const theme = createTheme({
  primaryColor: 'blueprint',
  colors: { blueprint, gray, red, orange, green, blue, yellow, teal },
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  headings: { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  defaultRadius: 'md',
  cursorType: 'pointer',
  components: {
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
