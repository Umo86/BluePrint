import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import type { Download, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { expectToast, staffSession, watchForErrors } from './helpers';

test.describe.configure({ mode: 'serial' });

async function openDashboard(page: Page) {
  await page.goto('/admin/shows');
  await page.getByRole('link', { name: 'UKCW London 2027' }).click();
  await page.getByRole('link', { name: 'Open show dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  return page.url().replace(/\/$/, '');
}

async function workbook(download: Download) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await readFile((await download.path())!)) as unknown as ArrayBuffer);
  return wb;
}

function columnValues(ws: ExcelJS.Worksheet, header: string) {
  const col = (ws.getRow(1).values as unknown[]).indexOf(header);
  const out: string[] = [];
  ws.eachRow((row, i) => {
    if (i > 1) out.push(String(row.getCell(col).value ?? ''));
  });
  return out;
}

let dashboard = '';

test('the overview shows progress and what needs attention', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchForErrors(page);
  await staffSession(page);
  dashboard = await openDashboard(page);
  await expect(page.getByText('Checklists done')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Deadlines' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Read the build-up and breakdown rules' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Stands to chase' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the team filters exhibitors by progress, emails chosen ones and downloads them', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchForErrors(page);
  await staffSession(page);
  await page.goto(`${dashboard}/exhibitors`);
  await page.getByRole('combobox', { name: 'Checklist' }).click();
  await page.getByRole('option', { name: 'Not started' }).click();
  await page.waitForURL(/progress=not_started/);
  await expect(page.getByText(/^Showing \d+ compan(y|ies) of \d+\.$/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'BrightBuild Windows' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download this list' })).toBeVisible();

  await page.getByRole('checkbox', { name: 'Choose BrightBuild Windows' }).check();
  await page.getByRole('checkbox', { name: 'Choose Cladtech Systems' }).check();
  await expect(page.getByText('2 companies chosen')).toBeVisible();
  await page.getByRole('button', { name: 'Email them' }).click();
  await expectToast(page, 'Email draft created.');
  await page.waitForURL(/\/emails\/campaigns\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Only the 2 stands you chose.')).toBeVisible();
  await expect(page.getByText(/^2 people at 2 stands/)).toBeVisible();

  await page.goto(`${dashboard}/exhibitors`);
  await page.getByRole('checkbox', { name: 'Choose Cladtech Systems' }).check();
  const [chosen] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download chosen (Excel)' }).click()]);
  expect(chosen.suggestedFilename()).toMatch(/exhibitors-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const wb = await workbook(chosen);
  expect(columnValues(wb.getWorksheet('Exhibitors')!, 'Company')).toEqual(['Cladtech Systems']);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('reports download as Excel files', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchForErrors(page);
  await staffSession(page);
  await page.goto(dashboard);
  await page.getByRole('navigation').getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();

  const [all] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download Exhibitors (Excel)' }).click()]);
  const wb = await workbook(all);
  expect(wb.worksheets.map((w) => w.name)).toEqual(['Exhibitors', 'About this file']);
  expect(columnValues(wb.getWorksheet('Exhibitors')!, 'Company')).toContain('Acme Insulation Ltd');

  const [checklist] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download Checklist by stand (Excel)' }).click()]);
  const cl = await workbook(checklist);
  const header = cl.getWorksheet('Checklist by stand')!.getRow(1).values as unknown[];
  expect(header).toContain('Read the build-up and breakdown rules');

  const [services] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download Services by stand (Excel)' }).click()]);
  expect((await workbook(services)).worksheets.map((w) => w.name)).toEqual(['By stand', 'By product', 'About this file']);

  await page.getByRole('link', { name: 'Services by stand (the delivery list)' }).click();
  await expect(page.getByRole('heading', { name: 'Services by stand' })).toBeVisible();
  await page.getByRole('tab', { name: 'By product' }).click();
  await page.waitForURL(/tab=products/);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the team emails every stand that has not done a task', async ({ page }) => {
  test.setTimeout(120_000);
  await staffSession(page);
  await page.goto(`${dashboard}/tasks`);
  await page.getByRole('link', { name: 'Read the build-up and breakdown rules' }).click();
  await page.getByRole('tab', { name: /Responses/ }).click();
  await page.getByRole('button', { name: /^Email the \d+ stands that have not done it$/ }).click();
  await expectToast(page, 'Reminder email drafted.');
  await page.waitForURL(/\/emails\/campaigns\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel('Subject')).toHaveValue('Reminder: Read the build-up and breakdown rules');
  await expect(page.getByRole('combobox', { name: 'Only stands that have not done this task' })).toHaveValue('Read the build-up and breakdown rules');
});
