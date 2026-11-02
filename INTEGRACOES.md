# Integrações por site

Cada integração vive em `bots/<id>/`. O site determina como preencher e confirmar os parâmetros, como obter o Request ID, como consultar a solicitação e como obter o resultado. Não se reutilizam seletores, limites de promoção ou URLs de API de outro site por suposição.

O manifesto identifica o site, parâmetros exigidos, política de cobrança e estágio da integração. Só uma implementação verificada pode habilitar geração. O diretório não contém perfis, cookies ou credenciais; caminhos e sessões são locais ao dispositivo.

## Contrato de execução

1. Ler e reconciliar os trabalhos ativos antes de preparar outro prompt. Uma solicitação sem identificação suficiente permanece incerta.
2. Usar o campo visível do formulário correto. Confirmar que React preservou o texto integral e que todos os parâmetros coincidem com o job.
3. Confirmar a autorização gratuita pelos mecanismos reais do site. Se não houver proteção verificável contra cobrança, manter a geração bloqueada.
4. Gravar `beginSubmit` antes da ação capaz de enviar. Essa gravação é a barreira de não reenvio.
5. Observar o envio e sua resposta. Associar a resposta à tentativa atual; guardar o Request ID antes de considerar a geração aceita.
6. Em rejeição de conteúdo confirmada, chamar `rejectContent`, remover o prompt da fila ativa e seguir. Não reescrever nem reenviar o texto.
7. Em timeout ou queda após a barreira, persistir ou recuperar como incerto e consultar o servidor. Não concluir que nada foi enviado porque o progresso não apareceu.
8. Vincular o resultado à solicitação atual. Baixar para um arquivo parcial exclusivo, preservando arquivos existentes.
9. Finalizar somente após validação local do MP4 e persistência do caminho. Nunca usar um MP4 antigo da página como resultado do novo job.

O primeiro job de uma integração precisa ser validado de ponta a ponta antes de continuar o lote automaticamente. Os testes locais não autorizam gerações extras nem comprovam funcionamento no Android.

## Responsabilidades do núcleo

`Queue` guarda os textos e parâmetros imutáveis por digest, controla transições e salva backups antes das alterações. `beginSubmit` exige ausência de solicitações ativas. Respostas aceitas e rejeições são correlacionadas com o ID da tentativa; resultados também exigem o mesmo Request ID. `complete` executa FFprobe sobre o arquivo local.

O núcleo não adivinha o estado remoto e não transforma timeout em permissão para reenviar. A integração deve repetir consultas de leitura quando necessário, jamais repetir um envio incerto. O tratamento de uma promoção é específico do site e da conta; não é inferido de um botão Run habilitado.

## Limites atuais

O contrato de fila está implementado e testado. Ainda não existe integração de geração ativada nesta revisão. A pasta FLUX contém o manifesto e o coletor usado para analisar o projeto anterior; o executor será incorporado após a leitura dos arquivos atuais, sem executar instaladores antigos ou substituir o perfil autenticado.
