import { Center, Container, Paper, Stack, Text, Title } from '@mantine/core';
import { BrandMark } from '@/components/brand';
import { ButtonLink } from '@/components/links';

export default function NotFound() {
  return (
    <Center mih="100vh" bg="var(--mantine-color-gray-0)" py="xl">
      <Container size={460} w="100%">
        <Stack gap="lg" align="center">
          <BrandMark />
          <Paper withBorder p="xl" radius="md" w="100%">
            <Stack gap="sm">
              <Title order={1} fz={22}>
                We couldn’t find that page
              </Title>
              <Text c="dimmed" fz="sm">
                The link may be out of date, or you may not have access to it. If someone sent you here, ask them to check the link.
              </Text>
              <ButtonLink href="/" mt="xs">
                Go to my BluePrint
              </ButtonLink>
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </Center>
  );
}

