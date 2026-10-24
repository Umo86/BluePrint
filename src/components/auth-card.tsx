import { Center, Container, Paper, Stack, Text, Title } from '@mantine/core';
import { BrandMark } from './brand';
import { PlatformNotice } from './platform-notice';

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Center mih="100vh" bg="var(--mantine-color-gray-0)" py="xl">
      <Container size={460} w="100%">
        <Stack gap="lg">
          <Center>
            <BrandMark />
          </Center>
          <PlatformNotice />
          <Paper withBorder shadow="sm" p="xl" radius="md">
            <Stack gap="md">
              <div>
                <Title order={1} fz={22}>
                  {title}
                </Title>
                {subtitle ? (
                  <Text c="dimmed" mt={4} fz="sm">
                    {subtitle}
                  </Text>
                ) : null}
              </div>
              {children}
            </Stack>
          </Paper>
          <Text ta="center" fz="xs" c="dimmed">
            BluePrint by Media10. Your information is protected and every change is logged.
          </Text>
        </Stack>
      </Container>
    </Center>
  );
}
